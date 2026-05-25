import { minimatch } from "minimatch";
import type { SemanticSearchResult, SemanticSearchResultItem } from "@harness/shared";
import type { EmbeddingsRepo } from "../db/repositories/embeddings.repo.js";
import type { IndexStatusRepo } from "../db/repositories/index-status.repo.js";
import type { Embedder } from "./embedder.js";
import { bufferToFloat32, cosineSimilarity } from "./vector.js";

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
  const rows = deps.embeddingsRepo.searchRows(input.workspaceId);
  if (rows.length === 0) {
    return { results: [], indexStatus };
  }

  const queryVec = await deps.embedder.embed(input.query);

  const scored: SemanticSearchResultItem[] = [];
  for (const row of rows) {
    if (input.filePattern && !minimatch(row.filePath, input.filePattern, { dot: true })) {
      continue;
    }
    const score = cosineSimilarity(queryVec, bufferToFloat32(row.embedding));
    if (score < input.minScore) continue;
    scored.push({
      path: row.filePath,
      startLine: row.startLine,
      endLine: row.endLine,
      content: row.content,
      score,
      language: row.language,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return { results: scored.slice(0, input.maxResults), indexStatus };
}
