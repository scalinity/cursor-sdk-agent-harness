import { minimatch } from "minimatch";
import type { SemanticSearchResult, SemanticSearchResultItem } from "@harness/shared";
import type { EmbeddingsRepo } from "../db/repositories/embeddings.repo.js";
import type { IndexStatusRepo } from "../db/repositories/index-status.repo.js";
import type { Embedder } from "./embedder.js";
import { cosineSimilarityBuffer } from "./vector.js";

export interface SemanticSearchDeps {
  embeddingsRepo: EmbeddingsRepo;
  indexStatusRepo: IndexStatusRepo;
  embedder: Embedder;
}

export interface SemanticSearchInput {
  query: string;
  workspaceId: string;
  maxResults: number;
  minScore: number;
  filePattern?: string;
}

function indexStatusSummary(
  deps: SemanticSearchDeps,
  workspaceId: string,
): SemanticSearchResult["indexStatus"] {
  const row = deps.indexStatusRepo.get(workspaceId);
  if (row) {
    return {
      status: row.status,
      totalChunks: row.totalChunks,
      lastIndexedAt: row.lastIndexedAt,
    };
  }
  return {
    status: "pending",
    totalChunks: deps.embeddingsRepo.countByWorkspace(workspaceId),
    lastIndexedAt: null,
  };
}

export async function semanticSearch(
  deps: SemanticSearchDeps,
  input: SemanticSearchInput,
): Promise<SemanticSearchResult> {
  const indexStatus = indexStatusSummary(deps, input.workspaceId);
  // P23 CA1-W1: score against vectors only (no content loaded), reading floats
  // directly from the BLOB Buffer (no per-row Float32Array copy).
  const rows = deps.embeddingsRepo.searchVectors(input.workspaceId);
  if (rows.length === 0) {
    return { results: [], indexStatus };
  }

  const queryVec = await deps.embedder.embed(input.query);

  const scored: Array<{ row: (typeof rows)[number]; score: number }> = [];
  for (const row of rows) {
    if (input.filePattern && !minimatch(row.filePath, input.filePattern, { dot: true })) {
      continue;
    }
    const score = cosineSimilarityBuffer(queryVec, row.embedding);
    if (score < input.minScore) continue;
    scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, input.maxResults);
  // Fetch content only for the survivors.
  const contentById = deps.embeddingsRepo.getContentByIds(top.map((t) => t.row.id));
  const results: SemanticSearchResultItem[] = top.map((t) => ({
    path: t.row.filePath,
    startLine: t.row.startLine,
    endLine: t.row.endLine,
    content: contentById.get(t.row.id) ?? "",
    score: t.score,
    language: t.row.language,
  }));
  return { results, indexStatus };
}
