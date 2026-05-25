import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerFilesRoutes } from "../files.routes.js";

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "harness-files-test-")));
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "README.md"), "# project\n");
  await fs.writeFile(path.join(dir, "src", "index.ts"), 'export const HELLO = "world";\n');
  return dir;
}

function setup(workspacePath: string | null) {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  if (workspacePath) {
    const entry = repos.workspaceAllowlist.create({ path: workspacePath });
    repos.settings.set("app.activeWorkspaceId", entry.id);
  }
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("GET /api/files/list", () => {
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

  it("lists the active workspace root", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerFilesRoutes(app, {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/files/list" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.relPath).toBe("");
    expect(body.parent).toBeNull();
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual(
      expect.arrayContaining(["src", "README.md"]),
    );
  });

  it("returns 412 when no workspace is active", async () => {
    const { db, repos, app } = setup(null);
    cleanup.push(() => app.close(), () => db.close());
    await registerFilesRoutes(app, {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/files/list" });
    expect(res.statusCode).toBe(412);
    expect(res.json().code).toBe("NO_ACTIVE_WORKSPACE");
  });

  it("returns 403 for a traversal attempt", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerFilesRoutes(app, {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/files/list?path=" + encodeURIComponent("../"),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("PATH_TRAVERSAL_REJECTED");
  });
});

describe("GET /api/files/read", () => {
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

  it("reads a file's content", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerFilesRoutes(app, {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/files/read?path=" + encodeURIComponent("src/index.ts"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe('export const HELLO = "world";\n');
    expect(body.binary).toBe(false);
  });

  it("returns 404 for a missing file", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerFilesRoutes(app, {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/files/read?path=" + encodeURIComponent("nope.ts"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an empty path with 422", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerFilesRoutes(app, {
      settingsRepo: repos.settings,
      workspaceAllowlist: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/files/read" });
    expect(res.statusCode).toBe(422);
  });
});
