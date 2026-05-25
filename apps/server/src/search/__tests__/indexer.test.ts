import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Fastify from "fastify";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import { WorkspaceIndexer } from "../indexer.js";
import { FakeEmbedder } from "../fake-embedder.js";

class CountingEmbedder extends FakeEmbedder {
  batches = 0;
  override embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.batches += 1;
    return super.embedBatch(texts);
  }
}

describe("WorkspaceIndexer", () => {
  let tmp: string;
  let db: ReturnType<typeof openTestDb>;
  let repos: Repositories;
  const logger = Fastify({ logger: false }).log;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "harness-indexer-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "src", "auth.ts"), "export function authenticate(user: string) {\n  return login(user);\n}\n");
    await fs.writeFile(path.join(tmp, "src", "math.ts"), "export function add(a: number, b: number) {\n  return a + b;\n}\n");
    // A file under node_modules must be skipped by the walker.
    await fs.mkdir(path.join(tmp, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(tmp, "node_modules", "ignored.ts"), "export const SHOULD_NOT_INDEX = 1;\n");
    db = openTestDb({ skipSeed: true });
    repos = createRepositories(db.raw);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function makeIndexer(embedder = new FakeEmbedder()): WorkspaceIndexer {
    return new WorkspaceIndexer({
      embeddingsRepo: repos.embeddings,
      indexStatusRepo: repos.indexStatus,
      embedder,
      logger,
    });
  }

  it("indexes workspace files and records indexed status", async () => {
    const indexer = makeIndexer();
    await indexer.indexWorkspace(tmp, tmp);
    expect(repos.embeddings.countByWorkspace(tmp)).toBeGreaterThanOrEqual(2);
    const status = repos.indexStatus.get(tmp);
    expect(status?.status).toBe("indexed");
    expect(status?.indexedFiles).toBe(2); // node_modules file excluded
    const files = repos.embeddings.listIndexedFiles(tmp).map((f) => f.filePath);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("skips unchanged files on re-index (incremental hash check)", async () => {
    await makeIndexer().indexWorkspace(tmp, tmp);
    const counter = new CountingEmbedder();
    await makeIndexer(counter).indexWorkspace(tmp, tmp);
    // No file changed → no batch should be embedded.
    expect(counter.batches).toBe(0);
  });

  it("re-embeds a changed file and prunes a deleted file", async () => {
    await makeIndexer().indexWorkspace(tmp, tmp);
    const before = repos.embeddings.countByWorkspace(tmp);
    expect(before).toBeGreaterThan(0);

    await fs.writeFile(path.join(tmp, "src", "math.ts"), "export const TAU = 6.283;\n");
    await fs.rm(path.join(tmp, "src", "auth.ts"));

    const counter = new CountingEmbedder();
    await makeIndexer(counter).indexWorkspace(tmp, tmp);
    expect(counter.batches).toBeGreaterThan(0); // math.ts re-embedded

    const files = new Set(repos.embeddings.listIndexedFiles(tmp).map((f) => f.filePath));
    expect(files.has(path.join("src", "math.ts"))).toBe(true);
    expect(files.has(path.join("src", "auth.ts"))).toBe(false); // pruned
  });

  it("does not run two concurrent indexes for the same workspace", async () => {
    const indexer = makeIndexer();
    const a = indexer.indexWorkspace(tmp, tmp);
    const b = indexer.indexWorkspace(tmp, tmp); // should early-return
    await Promise.all([a, b]);
    expect(repos.indexStatus.get(tmp)?.status).toBe("indexed");
  });
});
