import {
  createSubagentRequestSchema,
  listSubagentsResponseSchema,
  subagentSummarySchema,
  updateSubagentRequestSchema,
  type SubagentDefinitionRow,
  type SubagentSummary,
  type UpdateSubagentRequest,
} from "@harness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { z } from "zod";
import type { McpServersRepo } from "../db/repositories/mcp-servers.repo.js";
import type { SubagentDefinitionsRepo } from "../db/repositories/subagents.repo.js";

export interface SubagentsRoutesDeps {
  subagents: SubagentDefinitionsRepo;
  mcpServers: McpServersRepo;
}

function send422(reply: FastifyReply, error: z.ZodError) {
  return reply.code(422).send({
    code: "VALIDATION_ERROR",
    details: error.issues,
  });
}

function toSummary(row: SubagentDefinitionRow): SubagentSummary {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    description: row.description,
    prompt: row.prompt,
    model: row.model,
    mcpServerIds: row.mcpServerIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Spec §5 Subagent CRUD: a subagent's `mcpServerIds` may only reference
 * persisted MCP server rows. We reject save-time references to unknown
 * IDs so the API can't be coerced into producing AgentOptions that name a
 * non-existent server (the SDK would either silently ignore or hard-fail).
 *
 * REVIEW-S12: uses `existsBatch` (single SELECT id ... WHERE IN) instead
 * of `list()` + map + Set construction — avoids parsing every row's
 * config_json just to discard it.
 */
function findUnknownMcpIds(
  mcpServers: McpServersRepo,
  ids: ReadonlyArray<string>,
): string[] {
  if (ids.length === 0) return [];
  const known = mcpServers.existsBatch(ids);
  return ids.filter((id) => !known.has(id));
}

/**
 * REVIEW-S9 + REVIEW-S13: factor the PATCH body-to-update-input mapping
 * into one place. `model: null` is meaningful (set to inherit), so we
 * cannot use `??` — it would fold null into the existing model. We use
 * an explicit `!== undefined` check; the same rule lives in the repo's
 * update method.
 */
function patchToUpdateInput(
  body: UpdateSubagentRequest,
): Parameters<SubagentDefinitionsRepo["update"]>[1] {
  const input: Parameters<SubagentDefinitionsRepo["update"]>[1] = {};
  if (body.name !== undefined) input.name = body.name;
  if (body.enabled !== undefined) input.enabled = body.enabled;
  if (body.description !== undefined) input.description = body.description;
  if (body.prompt !== undefined) input.prompt = body.prompt;
  if (body.model !== undefined) input.model = body.model;
  if (body.mcpServerIds !== undefined) input.mcpServerIds = body.mcpServerIds;
  return input;
}

export async function registerSubagentsRoutes(
  app: FastifyInstance,
  deps: SubagentsRoutesDeps,
): Promise<void> {
  app.get("/api/subagents", async () => {
    const items = deps.subagents.list().map(toSummary);
    return listSubagentsResponseSchema.parse({ items });
  });

  app.post("/api/subagents", async (req, reply) => {
    const parsed = createSubagentRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    const unknown = findUnknownMcpIds(deps.mcpServers, parsed.data.mcpServerIds);
    if (unknown.length > 0) {
      return reply.code(422).send({
        code: "UNKNOWN_MCP_SERVER",
        message: `Unknown mcpServerIds: ${unknown.join(", ")}`,
        details: unknown,
      });
    }
    const row = deps.subagents.create({
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      description: parsed.data.description,
      prompt: parsed.data.prompt,
      model: parsed.data.model,
      mcpServerIds: parsed.data.mcpServerIds,
    });
    return reply.code(201).send(subagentSummarySchema.parse(toSummary(row)));
  });

  app.put<{ Params: { id: string } }>(
    "/api/subagents/:id",
    async (req, reply) => {
      const parsed = createSubagentRequestSchema.safeParse(req.body);
      if (!parsed.success) return send422(reply, parsed.error);
      const existing = deps.subagents.getById(req.params.id);
      if (!existing) return reply.code(404).send({ code: "NOT_FOUND" });
      const unknown = findUnknownMcpIds(deps.mcpServers, parsed.data.mcpServerIds);
      if (unknown.length > 0) {
        return reply.code(422).send({
          code: "UNKNOWN_MCP_SERVER",
          message: `Unknown mcpServerIds: ${unknown.join(", ")}`,
          details: unknown,
        });
      }
      const row = deps.subagents.update(req.params.id, {
        name: parsed.data.name,
        enabled: parsed.data.enabled,
        description: parsed.data.description,
        prompt: parsed.data.prompt,
        model: parsed.data.model,
        mcpServerIds: parsed.data.mcpServerIds,
      });
      return subagentSummarySchema.parse(toSummary(row));
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/subagents/:id",
    async (req, reply) => {
      const parsed = updateSubagentRequestSchema.safeParse(req.body);
      if (!parsed.success) return send422(reply, parsed.error);
      const existing = deps.subagents.getById(req.params.id);
      if (!existing) return reply.code(404).send({ code: "NOT_FOUND" });
      if (parsed.data.mcpServerIds) {
        const unknown = findUnknownMcpIds(
          deps.mcpServers,
          parsed.data.mcpServerIds,
        );
        if (unknown.length > 0) {
          return reply.code(422).send({
            code: "UNKNOWN_MCP_SERVER",
            message: `Unknown mcpServerIds: ${unknown.join(", ")}`,
            details: unknown,
          });
        }
      }
      const row = deps.subagents.update(req.params.id, patchToUpdateInput(parsed.data));
      return subagentSummarySchema.parse(toSummary(row));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/subagents/:id",
    async (req, reply) => {
      const existing = deps.subagents.getById(req.params.id);
      if (!existing) return reply.code(404).send({ code: "NOT_FOUND" });
      deps.subagents.delete(req.params.id);
      return reply.code(204).send();
    },
  );
}
