import {
  contextSearchQuerySchema,
  contextResolveRequestSchema,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { contextSearch, resolveMention } from "../services/context.service.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "../config/settings-keys.js";

export interface ContextRoutesDeps {
  settingsRepo: SettingsRepo;
  allowlistRepo: WorkspaceAllowlistRepo;
}

function getActiveWorkspaceRoot(deps: ContextRoutesDeps): string | null {
  const raw = deps.settingsRepo.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
  if (typeof raw !== "string" || raw.length === 0) return null;
  const entry = deps.allowlistRepo.findMatching(raw);
  return entry ? raw : null;
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
      parsed.data.mentions.map((m) => resolveMention(m, root)),
    );
    const totalTokenEstimate = resolved.reduce((sum, r) => sum + r.tokenEstimate, 0);

    return reply.send({ resolved, totalTokenEstimate });
  });
}
