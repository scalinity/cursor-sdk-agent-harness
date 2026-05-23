import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerSubagentsRoutes } from "../subagents.routes.js";

function setup() {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("/api/subagents", () => {
  let cleanup: Array<() => Promise<void> | void> = [];
  beforeEach(() => {
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it("creates a subagent with explicit model override", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerSubagentsRoutes(app, {
      subagents: repos.subagents,
      mcpServers: repos.mcpServers,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/subagents",
      payload: {
        name: "explorer",
        description: "fast read-only",
        prompt: "you explore the codebase",
        model: { id: "composer-2-5-fast" },
        mcpServerIds: [],
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("explorer");
    expect(body.model).toEqual({ id: "composer-2-5-fast" });
  });

  it("accepts model: null as inherit", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerSubagentsRoutes(app, {
      subagents: repos.subagents,
      mcpServers: repos.mcpServers,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/subagents",
      payload: {
        name: "child",
        description: "inherit",
        prompt: "do work",
        model: null,
        mcpServerIds: [],
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().model).toBe(null);
  });

  it("rejects unknown mcpServerIds with UNKNOWN_MCP_SERVER", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    await registerSubagentsRoutes(app, {
      subagents: repos.subagents,
      mcpServers: repos.mcpServers,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/subagents",
      payload: {
        name: "child",
        description: "inherit",
        prompt: "do work",
        model: null,
        mcpServerIds: ["does-not-exist"],
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("UNKNOWN_MCP_SERVER");
  });

  it("accepts mcpServerIds that reference known servers", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    const mcp = repos.mcpServers.create({
      name: "fs",
      config: { command: "/bin/echo" },
    });
    await registerSubagentsRoutes(app, {
      subagents: repos.subagents,
      mcpServers: repos.mcpServers,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/subagents",
      payload: {
        name: "fs-child",
        description: "filesystem-bound",
        prompt: "navigate the FS",
        model: null,
        mcpServerIds: [mcp.id],
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().mcpServerIds).toEqual([mcp.id]);
  });

  it("PATCH model: null sets inherit (does not preserve existing model)", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    const sub = repos.subagents.create({
      name: "x",
      description: "d",
      prompt: "p",
      model: { id: "composer-2-5" },
    });
    await registerSubagentsRoutes(app, {
      subagents: repos.subagents,
      mcpServers: repos.mcpServers,
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/subagents/${sub.id}`,
      payload: { model: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBe(null);
  });

  it("DELETE removes the row", async () => {
    const { db, repos, app } = setup();
    cleanup.push(() => app.close(), () => db.close());
    const sub = repos.subagents.create({
      name: "doomed",
      description: "d",
      prompt: "p",
      model: null,
    });
    await registerSubagentsRoutes(app, {
      subagents: repos.subagents,
      mcpServers: repos.mcpServers,
    });
    const first = await app.inject({
      method: "DELETE",
      url: `/api/subagents/${sub.id}`,
    });
    expect(first.statusCode).toBe(204);
    const second = await app.inject({
      method: "DELETE",
      url: `/api/subagents/${sub.id}`,
    });
    expect(second.statusCode).toBe(404);
  });
});
