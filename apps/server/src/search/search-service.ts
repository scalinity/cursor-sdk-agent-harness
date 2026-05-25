import type { FastifyBaseLogger } from "fastify";
import type { IndexStatus, SemanticSearchResult } from "@harness/shared";
import type { EmbeddingsRepo } from "../db/repositories/embeddings.repo.js";
import type { IndexStatusRepo } from "../db/repositories/index-status.repo.js";
import { createEmbedder, type Embedder } from "./embedder.js";
import { WorkspaceWatcher } from "./file-watcher.js";
import { WorkspaceIndexer } from "./indexer.js";
import { semanticSearch, type SemanticSearchInput } from "./semantic-search.service.js";

/**
 * Phase 23 — the server-facing facade over embedding, indexing, watching, and
 * querying. Routes and the @codebase resolver depend on this single object so
 * the embedder/indexer/watcher lifetimes are owned in one place.
 */

export interface SearchServiceDeps {
  embeddingsRepo: EmbeddingsRepo;
  indexStatusRepo: IndexStatusRepo;
  logger: FastifyBaseLogger;
  /** Injected in tests; defaults to the real WASM embedder. */
  embedder?: Embedder;
}

const NEEDS_INDEX_STATUSES = new Set(["pending", "error", "stale"]);

export class SearchService {
  readonly embedder: Embedder;
  private readonly indexer: WorkspaceIndexer;
  private readonly watcher: WorkspaceWatcher;

  constructor(private readonly deps: SearchServiceDeps) {
    this.embedder = deps.embedder ?? createEmbedder();
    this.indexer = new WorkspaceIndexer({
      embeddingsRepo: deps.embeddingsRepo,
      indexStatusRepo: deps.indexStatusRepo,
      embedder: this.embedder,
      logger: deps.logger,
    });
    this.watcher = new WorkspaceWatcher({ indexer: this.indexer, logger: deps.logger });
  }

  getStatus(workspaceId: string): IndexStatus {
    const row = this.deps.indexStatusRepo.get(workspaceId);
    if (row) {
      return {
        workspaceId,
        status: row.status as IndexStatus["status"],
        totalFiles: row.totalFiles,
        indexedFiles: row.indexedFiles,
        totalChunks: row.totalChunks,
        lastIndexedAt: row.lastIndexedAt,
        errorMessage: row.errorMessage,
      };
    }
    return {
      workspaceId,
      status: "pending",
      totalFiles: 0,
      indexedFiles: 0,
      totalChunks: this.deps.embeddingsRepo.countByWorkspace(workspaceId),
      lastIndexedAt: null,
      errorMessage: null,
    };
  }

  isIndexed(workspaceId: string): boolean {
    return this.deps.indexStatusRepo.get(workspaceId)?.status === "indexed";
  }

  isIndexing(workspaceId: string): boolean {
    return this.indexer.isIndexing(workspaceId);
  }

  /** Kick a background index if the workspace needs one; arm the watcher. */
  ensureIndexing(workspaceId: string, root: string): void {
    const row = this.deps.indexStatusRepo.get(workspaceId);
    const needs = !row || NEEDS_INDEX_STATUSES.has(row.status);
    if (needs && !this.indexer.isIndexing(workspaceId)) {
      void this.indexer.indexWorkspace(workspaceId, root).catch((err: unknown) => {
        this.deps.logger.error({ err, workspaceId }, "background index failed");
      });
    }
    this.watcher.start(workspaceId, root);
  }

  /** Force a (incremental) re-index in the background; arm the watcher. */
  reindex(workspaceId: string, root: string): { status: string; totalChunks: number } {
    if (!this.indexer.isIndexing(workspaceId)) {
      void this.indexer.indexWorkspace(workspaceId, root).catch((err: unknown) => {
        this.deps.logger.error({ err, workspaceId }, "manual reindex failed");
      });
    }
    this.watcher.start(workspaceId, root);
    return {
      status: "indexing",
      totalChunks: this.deps.embeddingsRepo.countByWorkspace(workspaceId),
    };
  }

  search(input: SemanticSearchInput): Promise<SemanticSearchResult> {
    return semanticSearch(
      {
        embeddingsRepo: this.deps.embeddingsRepo,
        indexStatusRepo: this.deps.indexStatusRepo,
        embedder: this.embedder,
      },
      input,
    );
  }

  stopWatching(): void {
    this.watcher.stop();
  }
}
