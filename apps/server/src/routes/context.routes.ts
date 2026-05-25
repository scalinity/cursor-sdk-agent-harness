import {
  contextSearchQuerySchema,
  contextResolveRequestSchema,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import type { DocsRepo } from "../db/repositories/docs.repo.js";
import type { NotepadsRepo } from "../db/repositories/notepads.repo.js";
import {
  contextSearch,
  resolveMention,
  type SemanticSearchProvider,
} from "../services/context.service.js";
import { getActiveWorkspaceRoot } from "../config/active-workspace.js";

export interface ContextRoutesDeps {
  settingsRepo: SettingsRepo;
  allowlistRepo: WorkspaceAllowlistRepo;
  docsRepo?: DocsRepo | undefined;
  notepadsRepo?: NotepadsRepo | undefined;
  searchService?: SemanticSearchProvider | undefined;
}

export async function registerContextRoutes(
  app: FastifyInstance,
  deps: ContextRoutesDeps,
): Promise<void> {
  app.get("/api/context/search", async (request, reply) => {
    const parsed = contextSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(422).send({ code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const root = getActiveWorkspaceRoot(deps);
    if (!root) {
      return reply.code(200).send({ files: [], symbols: [] });
    }
    const kinds = parsed.data.kinds?.split(",").map((k) => k.trim()).filter(Boolean);
    const result = await contextSearch(parsed.data.q, root, kinds);
    return reply.send(result);
  });

  app.post("/api/context/resolve", async (request, reply) => {
    const parsed = contextResolveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const root = getActiveWorkspaceRoot(deps);
    if (!root) {
      return reply.code(400).send({ code: "NO_WORKSPACE", message: "No active workspace" });
    }

    const resolved = await Promise.all(
      parsed.data.mentions.map((m) =>
        resolveMention(m, root, {
          docsRepo: deps.docsRepo,
          notepadsRepo: deps.notepadsRepo,
          searchService: deps.searchService,
        }),
      ),
    );
    const totalTokenEstimate = resolved.reduce((sum, r) => sum + r.tokenEstimate, 0);

    return reply.send({ resolved, totalTokenEstimate });
  });
}
