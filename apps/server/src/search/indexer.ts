import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { FastifyBaseLogger } from "fastify";
import type {
  EmbeddingInsert,
  EmbeddingsRepo,
} from "../db/repositories/embeddings.repo.js";
import type { IndexStatusRepo, IndexStatusRow } from "../db/repositories/index-status.repo.js";
import type { Embedder, EmbedProgress } from "./embedder.js";
import { chunkText } from "./chunker.js";
import {
  detectLanguage,
  loadIgnorePatterns,
  walkWorkspace,
  type WalkOptions,
} from "./file-walker.js";
import { float32ToBuffer } from "./vector.js";

export const EMBED_BATCH_SIZE = 32;
const PROGRESS_EVERY_FILES = 10;

export interface WorkspaceIndexerDeps {
  embeddingsRepo: EmbeddingsRepo;
  indexStatusRepo: IndexStatusRepo;
  embedder: Embedder;
  logger: FastifyBaseLogger;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const yieldToLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

export class WorkspaceIndexer {
  private readonly running = new Set<string>();

  constructor(private readonly deps: WorkspaceIndexerDeps) {}

  isIndexing(workspaceId: string): boolean {
    return this.running.has(workspaceId);
  }

  getStatus(workspaceId: string): IndexStatusRow | null {
    return this.deps.indexStatusRepo.get(workspaceId);
  }

  /**
   * Full (incremental) index of a workspace. Files whose content hash is
   * unchanged are skipped; files removed from disk are pruned. Safe to call
   * repeatedly — a second concurrent call for the same workspace is a no-op.
   */
  async indexWorkspace(
    workspaceId: string,
    rootPath: string,
    walkOptions: WalkOptions = {},
  ): Promise<void> {
    if (this.running.has(workspaceId)) return;
    this.running.add(workspaceId);
    try {
      await this.deps.embedder.initialize((p: EmbedProgress) => {
        this.deps.logger.debug({ workspaceId, embedderProgress: p }, "embedder loading");
      });

      const ignorePatterns = await loadIgnorePatterns(rootPath);
      const files = await walkWorkspace(rootPath, { ...walkOptions, ignorePatterns });
      this.deps.indexStatusRepo.setIndexing(workspaceId, files.length);

      const existing = new Map<string, string>();
      for (const ref of this.deps.embeddingsRepo.listIndexedFiles(workspaceId)) {
        existing.set(ref.filePath, ref.contentHash);
      }
      const present = new Set<string>();

      let processed = 0;
      for (const file of files) {
        present.add(file.relPath);
        try {
          const content = await fs.readFile(file.absPath, "utf8");
          const hash = sha256(content);
          if (existing.get(file.relPath) !== hash) {
            const inserts = await this.embedFile(workspaceId, file.relPath, content, hash);
            this.deps.embeddingsRepo.replaceFile(workspaceId, file.relPath, inserts);
          }
        } catch (err) {
          this.deps.logger.warn(
            { err, file: file.relPath },
            "indexer: failed to index file; skipping",
          );
        }
        processed += 1;
        if (processed % PROGRESS_EVERY_FILES === 0) {
          this.deps.indexStatusRepo.setProgress(
            workspaceId,
            processed,
            this.deps.embeddingsRepo.countByWorkspace(workspaceId),
          );
          await yieldToLoop();
        }
      }

      // Prune files that no longer exist on disk.
      for (const indexedPath of existing.keys()) {
        if (!present.has(indexedPath)) {
          this.deps.embeddingsRepo.deleteFile(workspaceId, indexedPath);
        }
      }

      this.deps.indexStatusRepo.setIndexed(
        workspaceId,
        files.length,
        files.length,
        this.deps.embeddingsRepo.countByWorkspace(workspaceId),
      );
    } catch (err) {
      this.deps.logger.error({ err, workspaceId }, "indexer: workspace index failed");
      this.deps.indexStatusRepo.setError(
        workspaceId,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.running.delete(workspaceId);
    }
  }

  /** Re-index a single changed file (used by the file watcher). */
  async reindexFile(workspaceId: string, relPath: string, absPath: string): Promise<void> {
    try {
      const content = await fs.readFile(absPath, "utf8");
      const hash = sha256(content);
      const inserts = await this.embedFile(workspaceId, relPath, content, hash);
      this.deps.embeddingsRepo.replaceFile(workspaceId, relPath, inserts);
      // P23 CR1-S2: the incremental reindex already refreshed this file's
      // chunks — don't mark the workspace stale (that would force a full
      // re-walk on the next query, making the debounced single-file path
      // redundant). Status stays `indexed`.
    } catch (err) {
      this.deps.logger.warn({ err, relPath }, "indexer: reindexFile failed");
    }
  }

  removeFile(workspaceId: string, relPath: string): void {
    this.deps.embeddingsRepo.deleteFile(workspaceId, relPath);
  }

  private async embedFile(
    workspaceId: string,
    relPath: string,
    content: string,
    fileHash: string,
  ): Promise<EmbeddingInsert[]> {
    const chunks = chunkText(content);
    if (chunks.length === 0) return [];
    const language = detectLanguage(relPath);
    const inserts: EmbeddingInsert[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await this.deps.embedder.embedBatch(batch.map((c) => c.content));
      // P23-W5: WASM embedding is synchronous CPU work; yield between batches
      // so a large file can't monopolize the single-threaded event loop.
      await yieldToLoop();
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const vec = vectors[j];
        if (!chunk || !vec) continue;
        inserts.push({
          workspaceId,
          filePath: relPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          language,
          content: chunk.content,
          embedding: float32ToBuffer(vec),
          contentHash: fileHash,
        });
      }
    }
    return inserts;
  }
}
