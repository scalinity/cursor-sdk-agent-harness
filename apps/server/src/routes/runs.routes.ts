import {
  createRunRequestSchema,
  createRunResponseSchema,
  getRunEventsQuerySchema,
  getRunEventsResponseSchema,
  listRunsQuerySchema,
  listRunsResponseSchema,
  runPatchSchema,
  runSearchQuerySchema,
  runSearchResultSchema,
  runSummarySchema,
  subagentListResponseSchema,
  transcriptResponseSchema,
  type ExecutionMode,
  type TokenUsage,
} from "@harness/shared";
import type { FastifyInstance } from "fastify";
import type { RunsRepo, RunHistoryListOptions } from "../db/repositories/runs.repo.js";
import type { EventsRepo } from "../db/repositories/events.repo.js";
import type { AgentsRepo } from "../db/repositories/agents.repo.js";
import { buildServerFrame } from "../ws/frame-builder.js";
import {
  AgentRuntimeError,
  WorkspaceRejectedError,
  type AgentRuntime,
} from "../sdk/index.js";
import { send422, sendRuntimeError, sendWorkspaceRejection } from "./route-errors.js";

export interface RunsRoutesDeps {
  runtime: AgentRuntime;
  runsRepo: RunsRepo;
  eventsRepo: EventsRepo;
  agentsRepo: AgentsRepo;
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function usageFromRun(row: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; reasoningTokens: number | null; costUsdMicros: number | null; usageSource: TokenUsage["usage_source"] | null }): TokenUsage {
  return {
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    cached_input_tokens: row.cachedInputTokens,
    reasoning_tokens: row.reasoningTokens,
    cost_usd_micros: row.costUsdMicros,
    usage_source: row.usageSource ?? "unavailable",
  };
}

function toRunSummary(row: {
  id: string;
  agentId: string;
  agentName?: string | null;
  name?: string | null;
  status: string;
  executionMode?: ExecutionMode | null;
  promptPreview: string;
  modelId: string | null;
  workspaceId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  costUsdMicros: number | null;
  usageSource: TokenUsage["usage_source"] | null;
  lastTurnInputTokens: number | null;
  lastTurnOutputTokens: number | null;
  toolCallCount?: number;
  errorToolCallCount?: number;
}) {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName ?? null,
    name: row.name ?? null,
    status: row.status,
    executionMode: row.executionMode ?? null,
    promptPreview: row.promptPreview,
    modelId: row.modelId,
    workspaceId: row.workspaceId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    reasoningTokens: row.reasoningTokens,
    costUsdMicros: row.costUsdMicros,
    usageSource: row.usageSource,
    lastTurnInputTokens: row.lastTurnInputTokens ?? null,
    lastTurnOutputTokens: row.lastTurnOutputTokens ?? null,
    toolCallCount: row.toolCallCount ?? 0,
    errorToolCallCount: row.errorToolCallCount ?? 0,
  };
}

function canonicalTranscriptEvent(row: ReturnType<EventsRepo["getAllByRunId"]>[number]) {
  return {
    event_id: row.id,
    schema_version: row.schemaVersion,
    seq: row.seq,
    agent_id: row.agentId,
    run_id: row.runId,
    occurred_at: row.occurredAt,
    received_at: row.receivedAt,
    sdk_type: row.sdkType,
    kind: row.kind,
    payload: row.payload,
  };
}

function textFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.text_delta === "string") return record.text_delta;
  if (typeof record.text === "string") return record.text;
  const content = record.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part !== "object" || part === null || Array.isArray(part)) return "";
        const block = part as Record<string, unknown>;
        return typeof block.text === "string" ? block.text : "";
      })
      .join("");
  }
  return null;
}

function toolNameFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const name = (payload as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

function summarizeSubagentEvent(row: ReturnType<EventsRepo["getRecentPreviewByRunId"]>[number]): string {
  const text = textFromPayload(row.payload);
  if (text) return text;
  const toolName = toolNameFromPayload(row.payload);
  if (toolName) return toolName;
  if (typeof row.status === "string") return row.status;
  return row.kind;
}

function subagentLastEvents(eventsRepo: EventsRepo, runId: string) {
  return eventsRepo
    .getRecentPreviewByRunId(runId, 5)
    .map((row) => ({
      seq: row.seq,
      kind: row.kind,
      summary: summarizeSubagentEvent(row).slice(0, 160),
      timestamp: row.occurredAt,
    }));
}

function isTerminalStatus(status: string): boolean {
  return status === "FINISHED" || status === "ERROR" || status === "CANCELLED" || status === "EXPIRED";
}

function isActiveSubagentStatus(status: string): boolean {
  return status === "CREATING" || status === "RUNNING";
}

function renderMarkdownTranscript(input: { run: ReturnType<RunsRepo["getById"]>; agentName: string; events: ReturnType<EventsRepo["getAllByRunId"]> }): string {
  const run = input.run;
  if (!run) return "";
  const lines: string[] = [
    `# Transcript: ${run.promptPreview || run.id}`,
    "",
    `- Run: ${run.id}`,
    `- Agent: ${input.agentName}`,
    `- Status: ${run.status}`,
    `- Started: ${run.startedAt}`,
    `- Finished: ${run.finishedAt ?? "n/a"}`,
    `- Cost micros: ${run.costUsdMicros ?? "unavailable"}`,
    "",
  ];
  for (const event of input.events) {
    if (event.sdkType === "assistant") {
      const text = textFromPayload(event.payload);
      if (text) lines.push("## Assistant", "", text, "");
    } else if (event.sdkType === "thinking") {
      const text = textFromPayload(event.payload);
      if (text) lines.push("<details><summary>Thinking</summary>", "", text, "", "</details>", "");
    } else if (event.sdkType === "user") {
      const text = textFromPayload(event.payload);
      if (text) lines.push("## User", "", text, "");
    } else if (event.sdkType === "tool_call") {
      lines.push(`- Tool call: ${toolNameFromPayload(event.payload) ?? event.kind} (${event.kind})`);
    }
  }
  if (run.finalText) lines.push("## Final Text", "", run.finalText, "");
  return `${lines.join("\n").trim()}\n`;
}

export async function registerRunsRoutes(
  app: FastifyInstance,
  deps: RunsRoutesDeps,
): Promise<void> {
  app.get("/api/runs", async (req, reply) => {
    const parsed = listRunsQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);
    const query = parsed.data;
    const limit = query.limit ?? query.pageSize;
    const offset = query.offset ?? (query.page - 1) * query.pageSize;
    const opts: RunHistoryListOptions = {
      limit,
      offset,
      sort: query.sort,
      hasCost: query.hasCost,
    };
    if (query.agentId !== undefined) opts.agentIds = splitCsv(query.agentId) ?? [query.agentId];
    if (query.from !== undefined) opts.from = query.from;
    if (query.to !== undefined) opts.to = query.to;
    const statuses = splitCsv(query.status);
    if (statuses !== undefined) opts.statuses = statuses;
    const modelIds = splitCsv(query.modelId);
    if (modelIds !== undefined) opts.modelIds = modelIds;
    const result = deps.runsRepo.listHistory(opts);
    const items = result.items.map(toRunSummary);
    return listRunsResponseSchema.parse({ items, total: result.total });
  });

  // Phase 19: Full-text search across runs
  app.get("/api/runs/search", async (req, reply) => {
    const parsed = runSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) return send422(reply, parsed.error);
    const results = deps.runsRepo.search(parsed.data.q, parsed.data.limit);
    return runSearchResultSchema.parse({ results });
  });

  app.get<{ Params: { runId: string } }>(
    "/api/runs/:runId/subagents",
    async (req, reply) => {
      const parent = deps.runsRepo.getById(req.params.runId);
      if (!parent) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      const subagents = deps.runsRepo.listSubagents(parent.id);
      const activeCount = subagents.filter((subagent) => isActiveSubagentStatus(subagent.status)).length;
      const completedCount = subagents.length - activeCount;
      const totalTokens = subagents.reduce((sum, subagent) => sum + subagent.tokenCount, 0);
      const totalTokensPartial = subagents.some((subagent) => subagent.tokenCountPartial);
      const totalCostPartial = subagents.some((subagent) => subagent.costMicros === null);
      const totalCostMicros =
        subagents.length > 0 && !totalCostPartial
          ? subagents.reduce((sum, subagent) => sum + (subagent.costMicros ?? 0), 0)
          : null;
      return subagentListResponseSchema.parse({
        subagents: subagents.map((subagent) => ({
          ...subagent,
          lastEvents: subagentLastEvents(deps.eventsRepo, subagent.runId),
        })),
        activeCount,
        completedCount,
        totalTokens,
        totalTokensPartial,
        totalCostMicros,
        totalCostPartial,
      });
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/api/runs/:runId",
    async (req, reply) => {
      const row = deps.runsRepo.getById(req.params.runId);
      if (!row) {
        return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      }
      return runSummarySchema.parse({
        ...toRunSummary({
          ...row,
          agentName: deps.agentsRepo.getById(row.agentId)?.name ?? null,
          toolCallCount: deps.eventsRepo.getAllByRunId(row.id).filter((evt) => evt.kind.startsWith("tool_call.")).length,
          errorToolCallCount: deps.eventsRepo.getAllByRunId(row.id).filter((evt) => evt.kind === "tool_call.error" || evt.status === "error").length,
        }),
      });
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/api/runs/:runId/events",
    async (req, reply) => {
      const run = deps.runsRepo.getById(req.params.runId);
      if (!run) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      const parsed = getRunEventsQuerySchema.safeParse(req.query);
      if (!parsed.success) return send422(reply, parsed.error);
      const rows = deps.eventsRepo.getReplayByRunIdRange(req.params.runId, {
        fromSeq: parsed.data.after_seq + 1,
        limit: parsed.data.limit,
        direction: parsed.data.direction,
      });
      const items = rows
        .map((row) => buildServerFrame(row, { replayed: true }))
        .filter((frame): frame is NonNullable<typeof frame> => frame !== null);
      const last = rows.at(-1);
      return getRunEventsResponseSchema.parse({
        items,
        total: deps.eventsRepo.countByRunId(req.params.runId, parsed.data.after_seq),
        nextAfterSeq: last && rows.length === parsed.data.limit ? last.seq : null,
      });
    },
  );

  app.get<{ Params: { runId: string }; Querystring: { format?: string } }>(
    "/api/runs/:runId/transcript",
    async (req, reply) => {
      const run = deps.runsRepo.getById(req.params.runId);
      if (!run) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      const agent = deps.agentsRepo.getById(run.agentId);
      if (!agent) return reply.code(404).send({ code: "AGENT_NOT_FOUND" });
      const events = deps.eventsRepo.getAllByRunId(run.id);
      const format = req.query.format ?? "json";
      if (format === "markdown") {
        return reply
          .type("text/markdown; charset=utf-8")
          .send(renderMarkdownTranscript({ run, agentName: agent.name, events }));
      }
      if (format !== "json") {
        return reply.code(422).send({ code: "VALIDATION_ERROR", message: "format must be json or markdown" });
      }
      return transcriptResponseSchema.parse({
        run: {
          id: run.id,
          agentId: run.agentId,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          modelId: run.modelId,
          promptPreview: run.promptPreview,
          usage: usageFromRun(run),
          finalText: run.finalText,
          gitMetadata: run.gitMetadata,
        },
        agent: { id: agent.id, name: agent.name, mode: agent.mode },
        events: events.map(canonicalTranscriptEvent),
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
      });
    },
  );

  app.delete<{ Params: { runId: string } }>("/api/runs/:runId", async (req, reply) => {
    const row = deps.runsRepo.getById(req.params.runId);
    if (!row) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
    if (!isTerminalStatus(row.status)) {
      return reply.code(409).send({
        code: "RUN_NOT_TERMINAL",
        message: "Only terminal runs can be deleted.",
      });
    }
    if (deps.runsRepo.hasNonTerminalInTree(req.params.runId)) {
      return reply.code(409).send({
        code: "RUN_TREE_NOT_TERMINAL",
        message: "Every child run must be terminal before deleting this run.",
      });
    }
    deps.runsRepo.delete(req.params.runId);
    return reply.code(204).send();
  });

  // Phase 19: Rename a run
  app.patch<{ Params: { runId: string } }>(
    "/api/runs/:runId",
    async (req, reply) => {
      const parsed = runPatchSchema.safeParse(req.body);
      if (!parsed.success) return send422(reply, parsed.error);
      const row = deps.runsRepo.getById(req.params.runId);
      if (!row) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      if (parsed.data.name !== undefined) {
        deps.runsRepo.updateName(req.params.runId, parsed.data.name);
      }
      const updated = deps.runsRepo.getById(req.params.runId);
      if (!updated) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      const patchEvents = deps.eventsRepo.getAllByRunId(updated.id);
      const toolEvents = patchEvents.filter((evt) => evt.kind.startsWith("tool_call."));
      return runSummarySchema.parse({
        ...toRunSummary({
          ...updated,
          agentName: deps.agentsRepo.getById(updated.agentId)?.name ?? null,
          toolCallCount: toolEvents.length,
          errorToolCallCount: toolEvents.filter((evt) => evt.kind === "tool_call.error" || evt.status === "error").length,
        }),
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
        return sendWorkspaceRejection(reply, err);
      }
      if (err instanceof AgentRuntimeError) return sendRuntimeError(reply, err);
      throw err;
    }
  });
}
