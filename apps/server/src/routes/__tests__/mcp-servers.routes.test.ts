import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerMcpServersRoutes } from "../mcp-servers.routes.js";
import type { McpValidationResult } from "../../mcp/mcp-validator.js";

function setup() {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("/api/mcp-servers", () => {
  let cleanup: Array<() => Promise<void> | void> = [];
  beforeEach(() => {
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it("creates an MCP server, probes it, and persists the verdict", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());

    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async (): Promise<McpValidationResult> => ({
        status: "valid",
        transport: "stdio",
        details: "ok",
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: {
        name: "github",
        enabled: true,
        config: { command: "/usr/bin/echo", args: ["hi"] },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("github");
    expect(body.validationStatus).toBe("valid");
    expect(body.lastCheckedAt).toEqual(expect.any(String));
    expect(body.configRedacted).toEqual({
      command: "/usr/bin/echo",
      args: ["hi"],
    });
    expect(body.transport).toBe("stdio");
  });

  it("redacts env tokens on list and headers/CLIENT_SECRET on http servers", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    repos.mcpServers.create({
      name: "stdio-srv",
      config: {
        command: "/bin/false",
        env: { GITHUB_TOKEN: "ghp_secret" },
      },
    });
    repos.mcpServers.create({
      name: "http-srv",
      config: {
        url: "https://example.test",
        headers: { Authorization: "Bearer abc", "X-Trace": "ok" },
        auth: { CLIENT_ID: "id", CLIENT_SECRET: "shh" },
      },
    });

    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => ({
        status: "valid" as const,
        transport: "stdio" as const,
      }),
    });

    const res = await app.inject({ method: "GET", url: "/api/mcp-servers" });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    const stdio = items.find((i: { name: string }) => i.name === "stdio-srv");
    const http = items.find((i: { name: string }) => i.name === "http-srv");
    expect(stdio.configRedacted.env.GITHUB_TOKEN).toBe("[REDACTED]");
    expect(http.configRedacted.headers.Authorization).toBe("[REDACTED]");
    expect(http.configRedacted.headers["X-Trace"]).toBe("ok");
    expect(http.configRedacted.auth.CLIENT_ID).toBe("id");
    expect(http.configRedacted.auth.CLIENT_SECRET).toBe("[REDACTED]");
  });

  it("reveal endpoint returns the unredacted config", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    const row = repos.mcpServers.create({
      name: "secret",
      config: {
        url: "https://example.test",
        auth: { CLIENT_ID: "id", CLIENT_SECRET: "shh" },
      },
    });
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => ({ status: "valid" as const, transport: "http" as const }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/mcp-servers/${row.id}/reveal`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config.auth.CLIENT_SECRET).toBe("shh");
    // REVIEW-W8: secrets must not sit in browser caches.
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("REVIEW-W7: reveal endpoint rate-limits to 1 req/sec/id", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    const row = repos.mcpServers.create({
      name: "secret",
      config: {
        url: "https://example.test",
        auth: { CLIENT_ID: "id", CLIENT_SECRET: "shh" },
      },
    });
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => ({ status: "valid" as const, transport: "http" as const }),
    });
    const first = await app.inject({
      method: "GET",
      url: `/api/mcp-servers/${row.id}/reveal`,
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "GET",
      url: `/api/mcp-servers/${row.id}/reveal`,
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe("RATE_LIMITED");
    expect(second.headers["retry-after"]).toBeDefined();
  });

  it("re-validates on config change but not on enabled-only PATCH", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    let probeCount = 0;
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => {
        probeCount++;
        return { status: "valid" as const, transport: "stdio" as const };
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: {
        name: "tool",
        enabled: true,
        config: { command: "/bin/echo" },
      },
    });
    const id = created.json().id;
    expect(probeCount).toBe(1);

    // PATCH name/enabled — no re-probe.
    await app.inject({
      method: "PATCH",
      url: `/api/mcp-servers/${id}`,
      payload: { enabled: false },
    });
    expect(probeCount).toBe(1);

    // PUT with same config — no re-probe.
    await app.inject({
      method: "PUT",
      url: `/api/mcp-servers/${id}`,
      payload: {
        name: "tool",
        enabled: false,
        config: { command: "/bin/echo" },
      },
    });
    expect(probeCount).toBe(1);

    // PUT with new config — re-probes.
    await app.inject({
      method: "PUT",
      url: `/api/mcp-servers/${id}`,
      payload: {
        name: "tool",
        enabled: false,
        config: { command: "/bin/false" },
      },
    });
    expect(probeCount).toBe(2);

    // /revalidate explicit — re-probes.
    await app.inject({ method: "POST", url: `/api/mcp-servers/${id}/revalidate` });
    expect(probeCount).toBe(3);
  });

  it("rejects duplicate names", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => ({ status: "valid" as const, transport: "stdio" as const }),
    });
    const first = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: { name: "dup", enabled: true, config: { command: "/x" } },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: { name: "dup", enabled: true, config: { command: "/x" } },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("NAME_CONFLICT");
  });

  it("REVIEW-C1: 422s when config contains the [REDACTED] sentinel (POST + PUT)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => ({ status: "valid" as const, transport: "stdio" as const }),
    });

    // POST guard
    const post = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: {
        name: "leaky",
        enabled: true,
        config: { command: "/usr/bin/echo", env: { GITHUB_TOKEN: "[REDACTED]" } },
      },
    });
    expect(post.statusCode).toBe(422);
    expect(post.json().code).toBe("REDACTED_SENTINEL_PRESENT");

    // Now create a clean row to exercise PUT.
    const created = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: {
        name: "clean",
        enabled: true,
        config: { command: "/usr/bin/echo", env: { GITHUB_TOKEN: "ghp_real" } },
      },
    });
    const id = created.json().id;

    // PUT guard — the redacted Authorization header would otherwise persist as the real secret.
    const put = await app.inject({
      method: "PUT",
      url: `/api/mcp-servers/${id}`,
      payload: {
        name: "clean",
        enabled: true,
        config: { url: "https://example.test", headers: { Authorization: "[REDACTED]" } },
      },
    });
    expect(put.statusCode).toBe(422);
    expect(put.json().code).toBe("REDACTED_SENTINEL_PRESENT");
  });

  it("REVIEW-W1: a throwing probe lands as 'unreachable' instead of stranding the row at 'unknown'", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => {
        throw new Error("synthetic probe failure");
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: {
        name: "probe-throws",
        enabled: true,
        config: { command: "/usr/bin/echo" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.validationStatus).toBe("unreachable");
    expect(body.validationMessage).toMatch(/synthetic probe failure/);
  });

  it("422s a malformed config", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => ({ status: "valid" as const, transport: "stdio" as const }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: { name: "bad", enabled: true, config: { banana: true } },
    });
    expect(res.statusCode).toBe(422);
  });

  it("DELETE removes the row and is idempotent on second call", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    const row = repos.mcpServers.create({
      name: "doomed",
      config: { command: "/x" },
    });
    await registerMcpServersRoutes(app, {
      mcpServers: repos.mcpServers,
      validatorOverride: async () => ({ status: "valid" as const, transport: "stdio" as const }),
    });

    const first = await app.inject({
      method: "DELETE",
      url: `/api/mcp-servers/${row.id}`,
    });
    expect(first.statusCode).toBe(204);
    const second = await app.inject({
      method: "DELETE",
      url: `/api/mcp-servers/${row.id}`,
    });
    expect(second.statusCode).toBe(404);
  });
});
