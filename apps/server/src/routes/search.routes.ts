import { grepSearchQuerySchema, fileSearchQuerySchema } from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { grepSearch, fileSearch } from "../services/search.service.js";
import { getActiveWorkspaceRoot } from "../config/active-workspace.js";

export interface SearchRoutesDeps {
  settingsRepo: SettingsRepo;
  allowlistRepo: WorkspaceAllowlistRepo;
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
}
