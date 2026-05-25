import type { FastifyInstance } from "fastify";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { readRulesFromWorkspace } from "../services/rules.service.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "../config/settings-keys.js";

export interface RulesRoutesDeps {
  settingsRepo: SettingsRepo;
  allowlistRepo: WorkspaceAllowlistRepo;
}

function getActiveWorkspaceRoot(deps: RulesRoutesDeps): string | null {
  const raw = deps.settingsRepo.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
  if (typeof raw !== "string" || raw.length === 0) return null;
  const entry = deps.allowlistRepo.findMatching(raw);
  return entry ? raw : null;
}

export async function registerRulesRoutes(
  app: FastifyInstance,
  deps: RulesRoutesDeps,
): Promise<void> {
  app.get("/api/rules", async (_request, reply) => {
    const root = getActiveWorkspaceRoot(deps);
    if (!root) {
      return reply.code(200).send([]);
    }
    const rules = await readRulesFromWorkspace(root, app.log);
    return reply.send(rules);
  });

  app.get<{ Params: { name: string } }>(
    "/api/rules/:name",
    async (request, reply) => {
      const root = getActiveWorkspaceRoot(deps);
      if (!root) {
        return reply.code(404).send({ code: "NO_WORKSPACE", message: "No active workspace" });
      }
      const rules = await readRulesFromWorkspace(root, app.log);
      const rule = rules.find((r) => r.name === request.params.name);
      if (!rule) {
        return reply.code(404).send({ code: "RULE_NOT_FOUND", message: `Rule ${request.params.name} not found` });
      }
      return reply.send(rule);
    },
  );
}
