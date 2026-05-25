import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import { registerSearchRoutes } from "../search.routes.js";
import { SearchService } from "../../search/search-service.js";
import { WorkspaceIndexer } from "../../search/indexer.js";
import { FakeEmbedder } from "../../search/fake-embedder.js";

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-sem-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return dir;
}

describe("GET /api/search/semantic", () => {
  let cleanup: Array<() => Promise<void> | void>;
  let services: SearchService[];

  beforeEach(() => {
    cleanup = [];
    services = [];
  });
  afterEach(async () => {
    for (const s of services) s.stopWatching();
    for (const fn of cleanup.reverse()) await fn();
  });

  async function setup(workspaces: string[], activeIdx: number) {
    const db = openTestDb({ skipSeed: true });
    const repos: Repositories = createRepositories(db.raw);
    const app = Fastify({ logger: false });
    const searchService = new SearchService({
      embeddingsRepo: repos.embeddings,
      indexStatusRepo: repos.indexStatus,
      logger: app.log,
      embedder: new FakeEmbedder(),
    });
    services.push(searchService);
    const entries = [];
    for (const ws of workspaces) {
      const entry = repos.workspaceAllowlist.create({ path: ws });
      entries.push(entry);
      // Pre-index synchronously so the route can read embeddings.
      const indexer = new WorkspaceIndexer({
        embeddingsRepo: repos.embeddings,
        indexStatusRepo: repos.indexStatus,
        embedder: new FakeEmbedder(),
        logger: app.log,
      });
      await indexer.indexWorkspace(ws, ws);
    }
    const active = entries[activeIdx];
    if (active) repos.settings.set("app.activeWorkspaceId", active.id);
    await registerSearchRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
      searchService,
    });
    cleanup.push(() => app.close(), () => db.close());
    return { app, repos };
  }

  it("returns chunks relevant to the query, ranked by score", async () => {
    const ws = await makeWorkspace({
      "src/auth.ts": "export function authenticate(user, password) {\n  return validateCredentials(user, password);\n}\n",
      "src/geometry.ts": "export function rectangleArea(width, height) {\n  return width * height;\n}\n",
    });
    cleanup.push(() => fs.rm(ws, { recursive: true, force: true }));
    const { app } = await setup([ws], 0);

    const res = await app.inject({
      method: "GET",
      url: `/api/search/semantic?q=${encodeURIComponent("authenticate user credentials password")}&minScore=0.05`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results[0].path).toContain("auth.ts");
    expect(body.results[0].score).toBeGreaterThan(0.05);
    expect(body.indexStatus.status).toBe("indexed");
  });

  it("respects the workspace boundary", async () => {
    const wsA = await makeWorkspace({
      "a.ts": "export const authenticateUserSessionToken = 1;\n",
    });
    const wsB = await makeWorkspace({
      "b.ts": "export const renderPixelGradientCanvas = 2;\n",
    });
    cleanup.push(() => fs.rm(wsA, { recursive: true, force: true }));
    cleanup.push(() => fs.rm(wsB, { recursive: true, force: true }));
    const { app } = await setup([wsA, wsB], 0); // active = A

    const res = await app.inject({
      method: "GET",
      url: `/api/search/semantic?q=${encodeURIComponent("authenticate session token")}&minScore=0`,
    });
    const body = res.json();
    // Only workspace A's file is searchable when A is active.
    for (const r of body.results) {
      expect(r.path).not.toContain("b.ts");
    }
  });

  it("422s on a missing query and 400s with no active workspace", async () => {
    const { app } = await setup([], -1);
    expect((await app.inject({ method: "GET", url: "/api/search/semantic" })).statusCode).toBe(422);
    expect(
      (await app.inject({ method: "GET", url: "/api/search/semantic?q=x" })).statusCode,
    ).toBe(400);
  });
});
