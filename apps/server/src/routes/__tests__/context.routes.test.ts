import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerContextRoutes } from "../context.routes.js";

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-test-"));
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "src", "index.ts"),
    'export function hello() { return "world"; }\nexport const FOO = 42;\n',
  );
  await fs.writeFile(
    path.join(dir, "src", "utils.ts"),
    "export type Config = { port: number };\nexport interface Options { verbose: boolean; }\n",
  );
  return dir;
}

function setup(workspacePath: string | null) {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  if (workspacePath) {
    repos.workspaceAllowlist.create({ path: workspacePath });
    repos.settings.set("app.activeWorkspaceId", workspacePath);
  }
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("/api/context/search", () => {
  let tmpDir: string;
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(async () => {
    tmpDir = await createTempWorkspace();
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns file and symbol results for a query", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerContextRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/context/search?q=hello",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.symbols.length).toBeGreaterThanOrEqual(1);
    expect(body.symbols[0].name).toBe("hello");
  });

  it("returns empty results when no workspace is active", async () => {
    const { db, repos, app } = setup(null);
    cleanup.push(() => app.close(), () => db.close());
    await registerContextRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/context/search?q=test",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.files).toHaveLength(0);
    expect(body.symbols).toHaveLength(0);
  });

  it("validates query parameter", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerContextRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/context/search",
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("/api/context/resolve", () => {
  let tmpDir: string;
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(async () => {
    tmpDir = await createTempWorkspace();
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves a file mention with content", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerContextRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/context/resolve",
      payload: {
        mentions: [
          { kind: "file", value: "src/index.ts", displayLabel: "index.ts" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolved).toHaveLength(1);
    expect(body.resolved[0].content).toContain("// File: src/index.ts");
    expect(body.resolved[0].content).toContain("export function hello");
    expect(body.totalTokenEstimate).toBeGreaterThan(0);
  });

  it("resolves a folder mention with directory listing", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerContextRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/context/resolve",
      payload: {
        mentions: [
          { kind: "folder", value: "src", displayLabel: "src" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolved).toHaveLength(1);
    expect(body.resolved[0].content).toContain("index.ts");
  });

  it("handles missing file gracefully", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerContextRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/context/resolve",
      payload: {
        mentions: [
          { kind: "file", value: "nonexistent.ts", displayLabel: "nonexistent.ts" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolved[0].content).toContain("[File not found");
  });

  it("returns 400 when no workspace is active", async () => {
    const { db, repos, app } = setup(null);
    cleanup.push(() => app.close(), () => db.close());
    await registerContextRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/context/resolve",
      payload: {
        mentions: [
          { kind: "file", value: "a.ts", displayLabel: "a.ts" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
