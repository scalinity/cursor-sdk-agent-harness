import {
  agentDetailResponseSchema,
  agentSummarySchema,
  createAgentRequestSchema,
  listAgentsQuerySchema,
  listAgentsResponseSchema,
  updateAgentRequestSchema,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { AgentsRepo } from "../db/repositories/agents.repo.js";
import {
  AgentRuntimeError,
  WorkspaceRejectedError,
  type AgentRuntime,
} from "../sdk/index.js";
import { send422, sendRuntimeError, sendWorkspaceRejection } from "./route-errors.js";

export interface AgentsRoutesDeps {
  runtime: AgentRuntime;
  agentsRepo: AgentsRepo;
}

export async function registerAgentsRoutes(
  app: FastifyInstance,
  deps: AgentsRoutesDeps,
): Promise<void> {
  app.get("/api/agents", async (req, reply) => {
    const parsed = listAgentsQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);
    const { limit, offset } = parsed.data;
    const all = deps.runtime.list();
    const items = all.slice(offset, offset + limit);
    return listAgentsResponseSchema.parse({ items });
  });

  app.get<{ Params: { agentId: string } }>(
    "/api/agents/:agentId",
    async (req, reply) => {
      try {
        const detail = deps.runtime.getById(req.params.agentId);
        return agentDetailResponseSchema.parse(detail);
      } catch (err) {
        if (err instanceof AgentRuntimeError) return sendRuntimeError(reply, err);
        throw err;
      }
    },
  );

  app.post("/api/agents", async (req, reply) => {
    const parsed = createAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    try {
      const row = await deps.runtime.create(parsed.data);
      return reply.code(201).send(agentSummarySchema.parse({
        id: row.id,
        name: row.name,
        status: row.status,
        mode: row.mode,
        executionMode: row.executionMode,
        modelId: row.modelId,
        modelParams: row.modelParams,
        runCount: 0,
        activeRunCount: 0,
        totalCostUsdMicros: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        lastActiveAt: row.lastActiveAt,
        createdAt: row.createdAt,
        terminatedAt: row.terminatedAt,
      }));
    } catch (err) {
      if (err instanceof WorkspaceRejectedError) {
        return sendWorkspaceRejection(reply, err);
      }
      if (err instanceof AgentRuntimeError) return sendRuntimeError(reply, err);
      throw err;
    }
  });

  app.post<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/resume",
    async (req, reply) => {
      try {
        const row = await deps.runtime.resume(req.params.agentId);
        return reply.code(200).send({
          id: row.id,
          status: row.status,
          lastActiveAt: row.lastActiveAt,
        });
      } catch (err) {
        if (err instanceof AgentRuntimeError) return sendRuntimeError(reply, err);
        throw err;
      }
    },
  );

  app.post<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/terminate",
    async (req, reply) => {
      try {
        await deps.runtime.terminate(req.params.agentId);
        return reply.code(200).send({ id: req.params.agentId, status: "terminated" });
      } catch (err) {
        if (err instanceof AgentRuntimeError) return sendRuntimeError(reply, err);
        throw err;
      }
    },
  );

  // Phase 19 / model switcher: Update agent execution mode and/or model.
  app.patch<{ Params: { agentId: string } }>(
    "/api/agents/:agentId",
    async (req, reply) => {
      const parsed = updateAgentRequestSchema.safeParse(req.body);
      if (!parsed.success) return send422(reply, parsed.error);
      if (
        parsed.data.executionMode === undefined &&
        parsed.data.modelId === undefined &&
        parsed.data.modelParams === undefined
      ) {
        return reply.code(422).send({
          code: "VALIDATION_ERROR",
          message: "executionMode, modelId, or modelParams is required",
        });
      }
      const existing = deps.agentsRepo.getById(req.params.agentId);
      if (!existing) {
        return reply.code(404).send({
          code: "AGENT_NOT_FOUND",
          message: `Agent ${req.params.agentId} not found.`,
        });
      }
      try {
        // Model switch first — it resets params to the new model's defaults —
        // then apply any explicit params (so `/effort` after a switch sticks).
        if (parsed.data.modelId !== undefined) {
          deps.runtime.updateModel(req.params.agentId, parsed.data.modelId);
        }
        if (parsed.data.modelParams !== undefined) {
          deps.runtime.setModelParams(req.params.agentId, parsed.data.modelParams);
        }
        if (parsed.data.executionMode !== undefined) {
          deps.agentsRepo.updateExecutionMode(req.params.agentId, parsed.data.executionMode);
        }
        const detail = deps.runtime.getById(req.params.agentId);
        return agentDetailResponseSchema.parse(detail);
      } catch (err) {
        if (err instanceof AgentRuntimeError) return sendRuntimeError(reply, err);
        throw err;
      }
    },
  );
}
