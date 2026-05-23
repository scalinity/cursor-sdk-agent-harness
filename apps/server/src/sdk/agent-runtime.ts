import type { FastifyBaseLogger } from "fastify";
import type {
  AgentDetailResponse,
  AgentRow,
  AgentSummary,
  CreateAgentRequest,
  CreateRunResponse,
  SDKMessage,
} from "@harness/shared";
import { sdkMessageSchema } from "@harness/shared";
import type { AgentsRepo, CreateAgentInput } from "../db/repositories/agents.repo.js";
import type { McpServersRepo } from "../db/repositories/mcp-servers.repo.js";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import type { SubagentDefinitionsRepo } from "../db/repositories/subagents.repo.js";
import type { CursorApiKeyStore } from "../keychain/cursor-api-key.js";
import type { WorkspacePolicy } from "../security/workspace-policy.js";
import { getSettingsSnapshot } from "../services/settings.service.js";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import { buildAgentOptions } from "./agent-options-builder.js";
import type { ActiveRuns } from "./active-runs.js";
import { LiveAgents } from "./live-agents.js";
import type { PersistAndBroadcastPipeline } from "./persist-and-broadcast.js";
import { RunController, newRunId } from "./run-controller.js";
import type { StreamSink } from "./stream-stub.js";
import type { SDKAgent, SdkAdapter } from "./sdk-adapter.js";

/**
 * Application-layer error codes surfaced to REST routes. Routes map these
 * to HTTP statuses; everything else (Workspace rejection, SDK errors) is
 * also surfaced via this enum so the HTTP shell stays small.
 */
export class AgentRuntimeError extends Error {
  constructor(
    readonly code:
      | "MISSING_API_KEY"
      | "AGENT_NOT_FOUND"
      | "AGENT_TERMINATED"
      | "RUN_NOT_FOUND"
      | "SDK_CREATE_FAILED"
      | "SDK_RESUME_FAILED"
      | "SDK_SEND_FAILED",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

export interface AgentRuntimeDeps {
  agentsRepo: AgentsRepo;
  runsRepo: RunsRepo;
  mcpRepo: McpServersRepo;
  subagentsRepo: SubagentDefinitionsRepo;
  settingsRepo: SettingsRepo;
  workspacePolicy: WorkspacePolicy;
  apiKeyStore: CursorApiKeyStore;
  sdk: SdkAdapter;
  logger: FastifyBaseLogger;
  /**
   * Phase 07: in-memory pub/sub-backed registry of running controllers. Owned
   * by `buildApp` because the WS plugin also needs to look up controllers by
   * runId (for `cancel_run` frames). Sharing one registry keeps the WS and
   * REST cancel paths in sync.
   */
  activeRuns: ActiveRuns;
  /**
   * Phase 07: persist-then-broadcast pipeline. Replaces Phase 06's stub
   * sink. Sees every SDK event, persists a canonical event row, and emits
   * to the run bus AFTER the commit. AgentRuntime hands it to RunController
   * as the stream sink and calls `dropRun(runId)` on termination so the
   * per-run text buffer doesn't leak.
   */
  pipeline: PersistAndBroadcastPipeline;
}

export interface AgentRuntime {
  create(input: CreateAgentRequest): Promise<AgentRow>;
  resume(agentId: string): Promise<AgentRow>;
  terminate(agentId: string): Promise<void>;
  list(): AgentSummary[];
  getById(agentId: string): AgentDetailResponse;
  startRun(input: { agentId: string; prompt: string }): Promise<CreateRunResponse>;
  /**
   * Test/teardown hook: synchronously close all open SDK handles and clear
   * the active-runs registry. Production code does not call this; tests
   * use it in `afterEach`.
   */
  shutdown(): Promise<void>;
}

export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  const activeRuns = deps.activeRuns;
  // Bounded LRU cache of live SDK handles. We reuse a single SDKAgent
  // across `startRun` calls (spec §4: "Subsequent prompts to the same
  // agent reuse the same durable agent handle"). Bound prevents a
  // long-running process that resumes many agents from leaking handles.
  // See ./live-agents.ts for eviction policy.
  const liveAgents = new LiveAgents({ logger: deps.logger });

  async function loadActiveAgent(row: AgentRow): Promise<SDKAgent> {
    const cached = liveAgents.get(row.id);
    if (cached) return cached;
    const apiKey = await mustApiKey();
    const opts = await buildAgentOptions({
      agent: row,
      apiKey,
      mcpServers: deps.mcpRepo.list(),
      subagents: deps.subagentsRepo.list(),
      workspacePolicy: deps.workspacePolicy,
    });
    try {
      const handle = await deps.sdk.resumeAgent(row.id, opts);
      liveAgents.set(row.id, handle);
      return handle;
    } catch (err) {
      throw new AgentRuntimeError(
        "SDK_RESUME_FAILED",
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
  }

  async function mustApiKey(): Promise<string> {
    const apiKey = await deps.apiKeyStore.getApiKey();
    if (apiKey === null || apiKey.length === 0) {
      throw new AgentRuntimeError(
        "MISSING_API_KEY",
        "No Cursor API key configured. Save one via PUT /api/settings/api-key.",
      );
    }
    return apiKey;
  }

  return {
    async create(input: CreateAgentRequest): Promise<AgentRow> {
      const apiKey = await mustApiKey();
      // Persist-before-SDK pattern: insert the row as `creating` first, then
      // call the SDK, then flip to `active`. On failure we mark `error` so
      // the picker can surface the problem rather than dropping the record.
      const createArgs = (
        overrides: { id?: string; status: "creating" | "active" },
      ): CreateAgentInput => ({
        ...(overrides.id !== undefined ? { id: overrides.id } : {}),
        name: input.name,
        status: overrides.status,
        mode: input.mode,
        modelId: input.modelId,
        cwd: input.cwd ?? null,
        settingSources: input.settingSources ?? null,
        sandboxEnabled: input.sandboxEnabled ?? null,
        cloudOptions: input.cloudOptions ?? null,
        mcpServerIds: input.mcpServerIds,
        subagentDefinitionIds: input.subagentDefinitionIds,
      });

      const initialRow = deps.agentsRepo.create(createArgs({ status: "creating" }));
      let options: Awaited<ReturnType<typeof buildAgentOptions>>;
      try {
        options = await buildAgentOptions({
          agent: initialRow,
          apiKey,
          mcpServers: deps.mcpRepo.list(),
          subagents: deps.subagentsRepo.list(),
          workspacePolicy: deps.workspacePolicy,
        });
      } catch (err) {
        deps.agentsRepo.updateStatus(initialRow.id, "error", err);
        throw err;
      }

      try {
        const handle = await deps.sdk.createAgent(options);
        if (handle.agentId !== initialRow.id) {
          // The SDK rotated our durable id. Swap atomically — `swapId`
          // wraps delete+insert in db.transaction so a failed re-insert
          // leaves the original row intact for inspection rather than
          // losing the record entirely.
          const replaced = deps.agentsRepo.swapId(initialRow.id, {
            ...createArgs({ id: handle.agentId, status: "active" }),
            id: handle.agentId,
          });
          deps.agentsRepo.updateLastActiveAt(replaced.id);
          liveAgents.set(replaced.id, handle);
          return replaced;
        }
        deps.agentsRepo.updateStatus(initialRow.id, "active");
        deps.agentsRepo.updateLastActiveAt(initialRow.id);
        liveAgents.set(initialRow.id, handle);
        const final = deps.agentsRepo.getById(initialRow.id);
        if (!final) {
          throw new AgentRuntimeError(
            "AGENT_NOT_FOUND",
            `Inserted agent vanished id=${initialRow.id}`,
          );
        }
        return final;
      } catch (err) {
        // The swap above is transactional, so on swap failure the original
        // row is still present and this updateStatus succeeds. On any
        // other SDK failure, the initial row is also present.
        deps.agentsRepo.updateStatus(initialRow.id, "error", err);
        if (err instanceof AgentRuntimeError) throw err;
        throw new AgentRuntimeError(
          "SDK_CREATE_FAILED",
          err instanceof Error ? err.message : String(err),
          err,
        );
      }
    },

    async resume(agentId: string): Promise<AgentRow> {
      const row = deps.agentsRepo.getById(agentId);
      if (!row) {
        throw new AgentRuntimeError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
      }
      if (row.status === "terminated") {
        // Resuming a terminated agent is allowed — spec §4 Terminate
        // Agent: "allow later reactivation by calling resume." We bump
        // the row out of terminated by flipping the status now.
        deps.agentsRepo.updateStatus(row.id, "active");
      }
      await loadActiveAgent(row);
      deps.agentsRepo.updateLastActiveAt(row.id);
      const updated = deps.agentsRepo.getById(row.id);
      if (!updated) {
        throw new AgentRuntimeError("AGENT_NOT_FOUND", `Agent ${row.id} vanished`);
      }
      return updated;
    },

    async terminate(agentId: string): Promise<void> {
      const row = deps.agentsRepo.getById(agentId);
      if (!row) {
        throw new AgentRuntimeError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
      }
      // Abort every active run owned by this agent BEFORE flipping status,
      // so the controllers' onTerminate handlers see the agent still active
      // when they unregister.
      const controllers = activeRuns.forAgent(agentId);
      await Promise.all(
        controllers.map(async (c) => {
          try {
            await c.cancel("agent_terminated");
          } catch (err) {
            deps.logger.warn(
              { err, runId: c.runId, agentId },
              "agent terminate: run cancel threw",
            );
          }
        }),
      );
      const handle = liveAgents.get(agentId);
      if (handle) {
        try {
          handle.close();
        } catch (err) {
          deps.logger.warn({ err, agentId }, "agent terminate: handle.close threw");
        }
        liveAgents.delete(agentId);
      }
      deps.agentsRepo.terminate(agentId);
    },

    list(): AgentSummary[] {
      const rows = deps.agentsRepo.list();
      const aggregates = deps.runsRepo.aggregatesByAgent();
      return rows.map((r) => buildSummary(r, aggregates.get(r.id)));
    },

    getById(agentId: string): AgentDetailResponse {
      const row = deps.agentsRepo.getById(agentId);
      if (!row) {
        throw new AgentRuntimeError("AGENT_NOT_FOUND", `Agent ${agentId} not found`);
      }
      const aggregates = deps.runsRepo.aggregatesByAgent().get(agentId);
      const latest = deps.runsRepo.getLatestForAgent(agentId);
      const summary = buildSummary(row, aggregates);
      return {
        ...summary,
        cwd: row.cwd,
        settingSources: row.settingSources,
        sandboxEnabled: row.sandboxEnabled,
        cloudOptions: row.cloudOptions,
        mcpServerIds: row.mcpServerIds,
        subagentDefinitionIds: row.subagentDefinitionIds,
        latestRunId: latest?.id ?? null,
        latestRunStatus: latest?.status ?? null,
      };
    },

    async startRun(input: {
      agentId: string;
      prompt: string;
    }): Promise<CreateRunResponse> {
      const row = deps.agentsRepo.getById(input.agentId);
      if (!row) {
        throw new AgentRuntimeError(
          "AGENT_NOT_FOUND",
          `Agent ${input.agentId} not found`,
        );
      }
      if (row.status === "terminated") {
        throw new AgentRuntimeError(
          "AGENT_TERMINATED",
          `Agent ${input.agentId} is terminated. Resume it first.`,
        );
      }
      // For local agents, re-validate every cwd before sending a new
      // prompt. The allowlist may have changed between agent creation
      // and now; we never trust stale state.
      if (row.mode === "local") {
        await buildAgentOptions({
          agent: row,
          apiKey: await mustApiKey(),
          mcpServers: deps.mcpRepo.list(),
          subagents: deps.subagentsRepo.list(),
          workspacePolicy: deps.workspacePolicy,
        });
      }
      const handle = await loadActiveAgent(row);
      const snapshot = getSettingsSnapshot(deps.settingsRepo);
      const runId = newRunId();
      const runRow = deps.runsRepo.create({
        id: runId,
        agentId: row.id,
        status: "CREATING",
        promptPreview: input.prompt.slice(0, 256),
        modelId: row.modelId,
        mode: row.mode,
      });
      const controller = new RunController(
        {
          runId: runRow.id,
          agentId: row.id,
          modelId: row.modelId,
          prompt: input.prompt,
          agent: handle,
          sdk: deps.sdk,
          runsRepo: deps.runsRepo,
          pricing: snapshot.pricing,
          sink: createPipelineSink({
            runId: runRow.id,
            agentId: row.id,
            agentMode: row.mode,
            pipeline: deps.pipeline,
            logger: deps.logger,
          }),
          logger: deps.logger,
        },
        (c) => {
          activeRuns.unregister(c.runId);
          // Drop the per-run text accumulator so a long-lived process doesn't
          // keep ghost buffers around after every run.
          deps.pipeline.dropRun(c.runId);
        },
      );
      activeRuns.register(controller);
      try {
        await controller.start();
      } catch (err) {
        activeRuns.unregister(controller.runId);
        // Symmetric cleanup with the onTerminate callback below: if
        // start() ingested any events before throwing, the per-run
        // text accumulator is now orphaned (the consume loop never
        // ran, so onTerminate won't fire). Drop it explicitly to
        // match the happy-path lifecycle.
        deps.pipeline.dropRun(controller.runId);
        deps.runsRepo.setInterrupted(
          controller.runId,
          "stream_error",
          err instanceof Error ? err.message : String(err),
        );
        throw new AgentRuntimeError(
          "SDK_SEND_FAILED",
          err instanceof Error ? err.message : String(err),
          err,
        );
      }
      deps.agentsRepo.updateLastActiveAt(row.id);
      const persisted = deps.runsRepo.getById(controller.runId);
      return {
        runId: controller.runId,
        agentId: row.id,
        status: persisted?.status ?? "RUNNING",
        startedAt: persisted?.startedAt ?? controller.startedAt.toISOString(),
      };
    },

    async shutdown(): Promise<void> {
      for (const handle of liveAgents.values()) {
        try {
          handle.close();
        } catch {
          // best-effort
        }
      }
      liveAgents.clear();
      activeRuns.clear();
    },
  };
}

/**
 * Build the per-run stream sink that hands every SDK event to the
 * persist-then-broadcast pipeline. Events that fail Zod validation against
 * `sdkMessageSchema` are logged and dropped — the SDK shouldn't produce
 * unknown discriminants, but if it does we'd rather skip than crash the
 * consume loop. Validation failures DO NOT advance the per-run sequence.
 */
function createPipelineSink(args: {
  runId: string;
  agentId: string;
  agentMode: "local" | "cloud";
  pipeline: PersistAndBroadcastPipeline;
  logger: FastifyBaseLogger;
}): StreamSink {
  return (event: unknown) => {
    const parsed = sdkMessageSchema.safeParse(event);
    if (!parsed.success) {
      args.logger.warn(
        {
          runId: args.runId,
          agentId: args.agentId,
          sdkType: (event as { type?: unknown })?.type,
          errors: parsed.error.flatten(),
        },
        "pipeline-sink: SDK event failed sdkMessageSchema; skipping persist+broadcast",
      );
      return;
    }
    const raw: SDKMessage = parsed.data;
    args.pipeline.ingestSDKMessage({
      raw,
      runId: args.runId,
      agentId: args.agentId,
      agentMode: args.agentMode,
    });
  };
}

function buildSummary(
  row: AgentRow,
  aggregates:
    | {
        runCount: number;
        activeRunCount: number;
        totalCostUsdMicros: number;
        totalInputTokens: number;
        totalOutputTokens: number;
      }
    | undefined,
): AgentSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    mode: row.mode,
    modelId: row.modelId,
    runCount: aggregates?.runCount ?? 0,
    activeRunCount: aggregates?.activeRunCount ?? 0,
    totalCostUsdMicros: aggregates?.totalCostUsdMicros ?? 0,
    totalInputTokens: aggregates?.totalInputTokens ?? 0,
    totalOutputTokens: aggregates?.totalOutputTokens ?? 0,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    terminatedAt: row.terminatedAt,
  };
}

