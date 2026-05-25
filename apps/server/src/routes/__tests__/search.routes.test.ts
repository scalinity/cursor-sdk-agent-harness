import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerSearchRoutes } from "../search.routes.js";
import { SearchService } from "../../search/search-service.js";
import { FakeEmbedder } from "../../search/fake-embedder.js";

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-search-test-"));
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "index.ts"), 'export const HELLO = "world";\n');
  await fs.writeFile(path.join(dir, "src", "utils.ts"), "export function add(a: number, b: number) { return a + b; }\n");
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
  const searchService = new SearchService({
    embeddingsRepo: repos.embeddings,
    indexStatusRepo: repos.indexStatus,
    logger: app.log,
    embedder: new FakeEmbedder(),
  });
  return { db, repos, app, searchService };
}

describe("/api/search/grep", () => {
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

  it("returns grep results for a matching query", async () => {
    const { db, repos, app, searchService } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerSearchRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
      searchService,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/search/grep?q=HELLO",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty results for non-matching query", async () => {
    const { db, repos, app, searchService } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerSearchRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
      searchService,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/search/grep?q=NONEXISTENT_TOKEN_XYZ",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toHaveLength(0);
  });

  it("returns 400 when no workspace is active", async () => {
    const { db, repos, app, searchService } = setup(null);
    cleanup.push(() => app.close(), () => db.close());
    await registerSearchRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
      searchService,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/search/grep?q=test",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("/api/search/files", () => {
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

  it("returns file results for a matching pattern", async () => {
    const { db, repos, app, searchService } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerSearchRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
      searchService,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/search/files?pattern=index",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.files.length).toBeGreaterThanOrEqual(1);
    expect(body.files[0].name).toBe("index.ts");
  });
});
