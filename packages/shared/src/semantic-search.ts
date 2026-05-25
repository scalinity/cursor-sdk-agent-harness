import { z } from "zod";
import { isoDateTimeSchema } from "./constants.js";

/**
 * Phase 23 — Semantic codebase search contracts.
 *
 * The embedding pipeline lives entirely server-side (ONNX WASM via
 * @xenova/transformers). These schemas are the REST boundary the web app
 * talks to: index status, the semantic query, and the result shape.
 */

export const indexStatusStateSchema = z.enum([
  "pending",
  "indexing",
  "indexed",
  "error",
  "stale",
]);
export type IndexStatusState = z.infer<typeof indexStatusStateSchema>;

/** Full indexing status for a workspace (settings page + statusbar badge). */
export const indexStatusSchema = z.object({
  workspaceId: z.string().nullable(),
  status: indexStatusStateSchema,
  totalFiles: z.number().int().nonnegative(),
  indexedFiles: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  lastIndexedAt: isoDateTimeSchema.nullable(),
  errorMessage: z.string().nullable(),
});
export type IndexStatus = z.infer<typeof indexStatusSchema>;

/**
 * Query params for `GET /api/search/semantic`. Numeric fields are coerced
 * because they arrive as querystring strings (matches Phase 20's
 * grepSearchQuerySchema convention).
 */
export const semanticSearchQuerySchema = z.object({
  q: z.string().min(1).max(2000),
  workspaceId: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(50).default(10),
  filePattern: z.string().optional(),
  minScore: z.coerce.number().min(0).max(1).default(0.3),
});
export type SemanticSearchQuery = z.infer<typeof semanticSearchQuerySchema>;

export const semanticSearchResultItemSchema = z.object({
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  content: z.string(),
  score: z.number(), // cosine similarity 0–1
  language: z.string().nullable(),
});
export type SemanticSearchResultItem = z.infer<typeof semanticSearchResultItemSchema>;

export const semanticSearchResultSchema = z.object({
  results: z.array(semanticSearchResultItemSchema),
  indexStatus: z.object({
    status: z.string(),
    totalChunks: z.number(),
    lastIndexedAt: z.string().nullable(),
  }),
});
export type SemanticSearchResult = z.infer<typeof semanticSearchResultSchema>;

/** Response from `POST /api/search/reindex` — kicks a background re-index. */
export const reindexResponseSchema = z.object({
  status: indexStatusStateSchema,
  totalChunks: z.number().int().nonnegative(),
  message: z.string().nullable(),
});
export type ReindexResponse = z.infer<typeof reindexResponseSchema>;
