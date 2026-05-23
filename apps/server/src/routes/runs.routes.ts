import {
  createRunRequestSchema,
  createRunResponseSchema,
  listRunsResponseSchema,
  runSummarySchema,
} from "@harness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { z } from "zod";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import {
  AgentRuntimeError,
  WorkspaceRejectedError,
  type AgentRuntime,
} from "../sdk/index.js";

export interface RunsRoutesDeps {
  runtime: AgentRuntime;
  runsRepo: RunsRepo;
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

export async function registerRunsRoutes(
  app: FastifyInstance,
  deps: RunsRoutesDeps,
): Promise<void> {
  app.get<{
    Querystring: { agentId?: string; limit?: string; offset?: string };
  }>("/api/runs", async (req) => {
    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? Number.parseInt(req.query.offset, 10) : 0;
    const rows = req.query.agentId
      ? deps.runsRepo.list({ agentId: req.query.agentId, limit, offset })
      : deps.runsRepo.list({ limit, offset });
    const items = rows.map((r) =>
      runSummarySchema.parse({
        id: r.id,
        agentId: r.agentId,
        status: r.status,
        promptPreview: r.promptPreview,
        modelId: r.modelId,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.durationMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cachedInputTokens: r.cachedInputTokens,
        reasoningTokens: r.reasoningTokens,
        costUsdMicros: r.costUsdMicros,
        usageSource: r.usageSource,
      }),
    );
    return listRunsResponseSchema.parse({ items, total: items.length });
  });

  app.get<{ Params: { runId: string } }>(
    "/api/runs/:runId",
    async (req, reply) => {
      const row = deps.runsRepo.getById(req.params.runId);
      if (!row) {
        return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      }
      return runSummarySchema.parse({
        id: row.id,
        agentId: row.agentId,
        status: row.status,
        promptPreview: row.promptPreview,
        modelId: row.modelId,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        durationMs: row.durationMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cachedInputTokens: row.cachedInputTokens,
        reasoningTokens: row.reasoningTokens,
        costUsdMicros: row.costUsdMicros,
        usageSource: row.usageSource,
      });
    },
  );

  app.post("/api/runs", async (req, reply) => {
    const parsed = createRunRequestSchema.safeParse(req.body);
    if (!parsed.success) return send422(reply, parsed.error);
    try {
      const result = await deps.runtime.startRun(parsed.data);
      return reply.code(201).send(createRunResponseSchema.parse(result));
    } catch (err) {
      if (err instanceof WorkspaceRejectedError) {
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
      if (err instanceof AgentRuntimeError) return sendRuntimeError(reply, err);
      throw err;
    }
  });
}
