import type { FastifyInstance } from "fastify";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { readRulesFromWorkspace } from "../services/rules.service.js";
import { getActiveWorkspaceRoot } from "../config/active-workspace.js";

export interface RulesRoutesDeps {
  settingsRepo: SettingsRepo;
  allowlistRepo: WorkspaceAllowlistRepo;
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
