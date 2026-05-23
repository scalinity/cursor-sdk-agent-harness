import {
  createSubagentRequestSchema,
  listSubagentsResponseSchema,
  subagentSummarySchema,
  updateSubagentRequestSchema,
  type SubagentDefinitionRow,
  type SubagentSummary,
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
 */
function findUnknownMcpIds(
  mcpServers: McpServersRepo,
  ids: ReadonlyArray<string>,
): string[] {
  if (ids.length === 0) return [];
  const known = new Set(mcpServers.list().map((r) => r.id));
  return ids.filter((id) => !known.has(id));
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
      const updateInput: Parameters<typeof deps.subagents.update>[1] = {};
      if (parsed.data.name !== undefined) updateInput.name = parsed.data.name;
      if (parsed.data.enabled !== undefined) updateInput.enabled = parsed.data.enabled;
      if (parsed.data.description !== undefined) updateInput.description = parsed.data.description;
      if (parsed.data.prompt !== undefined) updateInput.prompt = parsed.data.prompt;
      // `model: null` is meaningful here (set to inherit). The Zod
      // schema may yield `undefined` when the key is absent — narrow
      // before forwarding so the repo's `undefined` vs `null` branch
      // works as documented.
      if (parsed.data.model !== undefined) {
        updateInput.model = parsed.data.model;
      }
      if (parsed.data.mcpServerIds !== undefined) {
        updateInput.mcpServerIds = parsed.data.mcpServerIds;
      }
      const row = deps.subagents.update(req.params.id, updateInput);
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
