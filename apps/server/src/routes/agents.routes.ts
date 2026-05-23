import {
  agentDetailResponseSchema,
  agentSummarySchema,
  createAgentRequestSchema,
  listAgentsResponseSchema,
} from "@harness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { z } from "zod";
import {
  AgentRuntimeError,
  WorkspaceRejectedError,
  type AgentRuntime,
} from "../sdk/index.js";

export interface AgentsRoutesDeps {
  runtime: AgentRuntime;
}

function send422(reply: FastifyReply, error: z.ZodError) {
  return reply.code(422).send({
    code: "VALIDATION_ERROR",
    details: error.issues,
  });
}

function sendRuntimeError(reply: FastifyReply, err: AgentRuntimeError) {
  switch (err.code) {
    case "MISSING_API_KEY":
      return reply.code(412).send({ code: err.code, message: err.message });
    case "AGENT_NOT_FOUND":
    case "RUN_NOT_FOUND":
      return reply.code(404).send({ code: err.code, message: err.message });
    case "AGENT_TERMINATED":
      return reply.code(409).send({ code: err.code, message: err.message });
    case "SDK_CREATE_FAILED":
    case "SDK_RESUME_FAILED":
    case "SDK_SEND_FAILED":
      return reply.code(502).send({ code: err.code, message: err.message });
    default: {
      const _exhaustive: never = err.code;
      return reply.code(500).send({ code: "INTERNAL", message: err.message, _: _exhaustive });
    }
  }
}

function sendWorkspaceRejection(reply: FastifyReply, err: WorkspaceRejectedError) {
  return reply.code(403).send({
    code: "WORKSPACE_REJECTED",
    message: err.message,
    details: err.details.map((d) => ({
      input: d.input,
      reason: d.decision.reason,
      normalizedPath: d.decision.normalizedPath,
    })),
  });
}

export async function registerAgentsRoutes(
  app: FastifyInstance,
  deps: AgentsRoutesDeps,
): Promise<void> {
  app.get("/api/agents", async () => {
    const items = deps.runtime.list().map((s) => agentSummarySchema.parse(s));
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
      return reply.code(201).send({
        id: row.id,
        name: row.name,
        status: row.status,
        mode: row.mode,
        modelId: row.modelId,
        createdAt: row.createdAt,
      });
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
}
