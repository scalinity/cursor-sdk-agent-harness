import {
  grepSearchQuerySchema,
  fileSearchQuerySchema,
  semanticSearchQuerySchema,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { grepSearch, fileSearch } from "../services/search.service.js";
import type { SearchService } from "../search/search-service.js";
import { getActiveWorkspaceRoot } from "../config/active-workspace.js";

export interface SearchRoutesDeps {
  settingsRepo: SettingsRepo;
  allowlistRepo: WorkspaceAllowlistRepo;
  searchService: SearchService;
}

/**
 * Resolve the workspace root for a request. An explicit `workspaceId` may be
 * either an allowlist row id or an already-allowed filesystem path; otherwise
 * the active workspace is used.
 */
function resolveWorkspaceRoot(
  deps: SearchRoutesDeps,
  explicit: string | undefined,
): string | null {
  if (explicit) {
    const row = deps.allowlistRepo.getById(explicit);
    if (row) return row.path;
    if (deps.allowlistRepo.findMatching(explicit)) return explicit;
  }
  return getActiveWorkspaceRoot(deps);
}

export async function registerSearchRoutes(
  app: FastifyInstance,
  deps: SearchRoutesDeps,
): Promise<void> {
  app.get("/api/search/grep", async (request, reply) => {
    const parsed = grepSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(422).send({ code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const root = getActiveWorkspaceRoot(deps);
    if (!root) {
      return reply.code(400).send({ code: "NO_WORKSPACE", message: "No active workspace" });
    }
    const result = await grepSearch({
      query: parsed.data.q,
      workspaceRoot: root,
      maxResults: parsed.data.maxResults,
      filePattern: parsed.data.filePattern,
      caseSensitive: parsed.data.caseSensitive,
    });
    return reply.send(result);
  });

  app.get("/api/search/files", async (request, reply) => {
    const parsed = fileSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(422).send({ code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const root = getActiveWorkspaceRoot(deps);
    if (!root) {
      return reply.code(400).send({ code: "NO_WORKSPACE", message: "No active workspace" });
    }
    const result = await fileSearch({
      pattern: parsed.data.pattern,
      workspaceRoot: root,
      maxResults: parsed.data.maxResults,
    });
    return reply.send(result);
  });

  // ── Phase 23: semantic (vector) search ──────────────────────────────────

  app.get("/api/search/semantic", async (request, reply) => {
    const parsed = semanticSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(422).send({ code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const root = resolveWorkspaceRoot(deps, parsed.data.workspaceId);
    if (!root) {
      return reply.code(400).send({ code: "NO_WORKSPACE", message: "No active workspace" });
    }
    // First query on an unindexed workspace kicks a background index.
    deps.searchService.ensureIndexing(root, root);
    const result = await deps.searchService.search({
      query: parsed.data.q,
      workspaceId: root,
      maxResults: parsed.data.maxResults,
      minScore: parsed.data.minScore,
      ...(parsed.data.filePattern !== undefined
        ? { filePattern: parsed.data.filePattern }
        : {}),
    });
    return reply.send(result);
  });

  app.get("/api/search/index-status", async (_request, reply) => {
    const root = getActiveWorkspaceRoot(deps);
    if (!root) {
      return reply.send({
        workspaceId: null,
        status: "pending",
        totalFiles: 0,
        indexedFiles: 0,
        totalChunks: 0,
        lastIndexedAt: null,
        errorMessage: null,
      });
    }
    return reply.send(deps.searchService.getStatus(root));
  });

  app.post("/api/search/reindex", async (_request, reply) => {
    const root = getActiveWorkspaceRoot(deps);
    if (!root) {
      return reply.code(400).send({ code: "NO_WORKSPACE", message: "No active workspace" });
    }
    const { status, totalChunks } = deps.searchService.reindex(root, root);
    return reply.send({ status, totalChunks, message: null });
  });
}
