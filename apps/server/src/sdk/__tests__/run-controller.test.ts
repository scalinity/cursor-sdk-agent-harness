import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pino } from "pino";
import type { FastifyBaseLogger } from "fastify";
import type { AgentMode, SettingsSnapshot } from "@harness/shared";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { AgentsRepo } from "../../db/repositories/agents.repo.js";
import { RunsRepo } from "../../db/repositories/runs.repo.js";
import { RunController, newRunId } from "../run-controller.js";
import type { SdkAdapter, SendOptions } from "../sdk-adapter.js";
import { createStubSdkAdapter, StubRun, StubSDKAgent } from "../testing.js";
import type { PersistAndBroadcastPipeline } from "../persist-and-broadcast.js";

type RecordedTerminalEvent = Parameters<PersistAndBroadcastPipeline["appendCanonicalEvent"]>[0];

const pricing: SettingsSnapshot["pricing"] = {
  composer25Fast: {
    inputPerMillionUsdMicros: 2_000_000,
    outputPerMillionUsdMicros: 8_000_000,
    cachedInputPerMillionUsdMicros: 200_000,
  },
  composer25: {
    inputPerMillionUsdMicros: 5_000_000,
    outputPerMillionUsdMicros: 15_000_000,
    cachedInputPerMillionUsdMicros: 500_000,
  },
  promoMultiplier: 1,
  lastVerifiedAt: null,
};

interface Fixture {
  db: ReturnType<typeof openTestDb>;
  agents: AgentsRepo;
  runs: RunsRepo;
  logger: FastifyBaseLogger;
  agentId: string;
  terminalEvents: RecordedTerminalEvent[];
  pipeline: Pick<PersistAndBroadcastPipeline, "appendCanonicalEvent">;
  cleanup: () => void;
}

function setupFixture(): Fixture {
  const db = openTestDb();
  const agents = new AgentsRepo(db.raw);
  const runs = new RunsRepo(db.raw);
  const logger = pino({ level: "silent" }) as unknown as FastifyBaseLogger;
  const terminalEvents: RecordedTerminalEvent[] = [];
  const agent = agents.create({
    id: "agent-rc-test",
    name: "rc-test",
    status: "active",
    mode: "local",
    modelId: "composer-2-5-fast",
  });
  return {
    db,
    agents,
    runs,
    logger,
    agentId: agent.id,
    terminalEvents,
    pipeline: {
      appendCanonicalEvent: (event) => {
        terminalEvents.push(event);
      },
    },
    cleanup: () => db.raw.close(),
  };
}

describe("RunController", () => {
  let f: Fixture;
  beforeEach(() => {
    f = setupFixture();
  });
  afterEach(() => {
    f.cleanup();
  });

  async function startController(
    sdk: SdkAdapter,
    overrides: { runId?: string; mode?: AgentMode } = {},
  ): Promise<{ controller: RunController; runId: string }> {
    const runId = overrides.runId ?? newRunId();
    f.runs.create({
      id: runId,
      agentId: f.agentId,
      status: "CREATING",
      promptPreview: "test",
      modelId: "composer-2-5-fast",
    });
    const stubAgent = await sdk.createAgent({ apiKey: "sk-test-12345678" });
    const controller = new RunController(
      {
        runId,
        agentId: f.agentId,
        modelId: "composer-2-5-fast",
        mode: overrides.mode ?? "local",
        prompt: "hello",
        agent: stubAgent as StubSDKAgent,
        sdk,
        runsRepo: f.runs,
        pricing,
        sink: async () => undefined,
        pipeline: f.pipeline,
        logger: f.logger,
      },
      () => undefined,
    );
    await controller.start();
    return { controller, runId };
  }

  /**
   * Adapter whose first `send` rejects exactly like the SDK does when the
   * agent's persisted `active_run_id` is wedged (`already has active run`),
   * then succeeds on the second call. `sends` records the SendOptions of
   * every attempt so a test can assert whether `local.force` was supplied.
   */
  function wedgedThenOkAdapter(agentId: string): {
    adapter: SdkAdapter;
    sends: SendOptions[];
  } {
    const sends: SendOptions[] = [];
    const adapter: SdkAdapter = {
      async createAgent() {
        return new StubSDKAgent(agentId);
      },
      async resumeAgent() {
        return new StubSDKAgent(agentId);
      },
      async send(_agent, _message, sendOptions) {
        sends.push(sendOptions);
        if (sends.length === 1) {
          throw new Error(`Agent ${agentId} already has active run`);
        }
        return new StubRun(
          {
            runId: sendOptions.idempotencyKey ?? "stub",
            agentId,
            events: [],
            finalResult: { status: "finished", durationMs: 5 },
          },
          sendOptions.onDelta,
        );
      },
    };
    return { adapter, sends };
  }

  it("cancel() writes CANCELLED, not ERROR (FIX-A regression)", async () => {
    // Stub a run with a single status=RUNNING event and a long-running
    // generator so we can cancel mid-stream.
    const sdk = createStubSdkAdapter({
      onSend: ({ agent, idempotencyKey }) => ({
        runId: idempotencyKey ?? "stub",
        agentId: agent.agentId,
        // No events — stream returns immediately, then wait() resolves
        // 'cancelled' once cancel() has flipped the StubRun's flag.
        events: [],
        finalResult: { status: "finished", durationMs: 5 },
      }),
    });
    const { controller, runId } = await startController(sdk);
    const result = await controller.cancel("user_cancelled");
    expect(result).toEqual({ outcome: "cancelled" });
    await controller.awaitSettled();
    const row = f.runs.getById(runId);
    expect(row?.status).toBe("CANCELLED");
    expect(row?.interruptedReason).toBe("user_cancelled");
    expect(f.terminalEvents).toContainEqual(
      expect.objectContaining({
        runId,
        kind: "run.interrupted",
        payload: { reason: "user_cancelled" },
      }),
    );
  });

  it("cancel() returns unsupported, keeps RUNNING, and emits system.cancel_unavailable (CA-P25-C5)", async () => {
    const sdk = createStubSdkAdapter({
      onSend: ({ agent, idempotencyKey }) => ({
        runId: idempotencyKey ?? "stub",
        agentId: agent.agentId,
        events: [],
        finalResult: { status: "finished", durationMs: 5 },
        supportsCancel: false,
      }),
    });
    const { controller, runId } = await startController(sdk);
    const result = await controller.cancel("user_cancelled");
    expect(result.outcome).toBe("unsupported");
    const row = f.runs.getById(runId);
    expect(row?.status).toBe("RUNNING");
    expect(row?.interruptedReason).toBeNull();
    expect(f.terminalEvents).toContainEqual(
      expect.objectContaining({
        runId,
        kind: "system.cancel_unavailable",
        sdkType: "system",
      }),
    );
  });

  it("setStatus refuses to regress a FINISHED row to RUNNING (CRIT-1)", async () => {
    // The stub yields RUNNING -> assistant -> FINISHED -> RUNNING.
    // Pre-fix, the trailing RUNNING frame would overwrite FINISHED.
    const sdk = createStubSdkAdapter({
      onSend: ({ agent, idempotencyKey }) => ({
        runId: idempotencyKey ?? "stub",
        agentId: agent.agentId,
        events: [
          { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "RUNNING" },
          {
            type: "assistant",
            agent_id: agent.agentId,
            run_id: idempotencyKey,
            message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
          },
          { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "FINISHED" },
          // Stray late-arriving RUNNING — must NOT regress the terminal status.
          { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "RUNNING" },
        ],
        finalResult: { status: "finished", durationMs: 5 },
      }),
    });
    const runId = newRunId();
    f.runs.create({
      id: runId,
      agentId: f.agentId,
      status: "CREATING",
      promptPreview: "test",
      modelId: "composer-2-5-fast",
    });
    const stubAgent = await sdk.createAgent({ apiKey: "sk-test-12345678" });
    const controller = new RunController(
      {
        runId,
        agentId: f.agentId,
        modelId: "composer-2-5-fast",
        mode: "local",
        prompt: "hello",
        agent: stubAgent as StubSDKAgent,
        sdk,
        runsRepo: f.runs,
        pricing,
        sink: async () => undefined,
        pipeline: f.pipeline,
        logger: f.logger,
      },
      () => undefined,
    );
    await controller.start();
    await controller.awaitSettled();
    const row = f.runs.getById(runId);
    expect(row?.status).toBe("FINISHED");
    expect(f.terminalEvents).toContainEqual(
      expect.objectContaining({
        runId,
        kind: "run.final_result",
        payload: expect.objectContaining({ usage: expect.any(Object) }),
      }),
    );
  });

  it("AgentsRepo.swapId transactionally relabels an agent's durable id (FIX-D)", () => {
    // Direct repo test — proves the swap is atomic without requiring the
    // (currently mid-refactor) AgentRuntime.create call site.
    const oldId = "agent-original";
    const newId = "agent-sdk-rotated";
    f.agents.create({
      id: oldId,
      name: "rotate-me",
      status: "creating",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const replaced = f.agents.swapId(oldId, {
      id: newId,
      name: "rotate-me",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    expect(replaced.id).toBe(newId);
    expect(replaced.status).toBe("active");
    expect(f.agents.getById(oldId)).toBeNull();
    expect(f.agents.getById(newId)).not.toBeNull();
  });

  it("AgentsRepo.swapId rolls back when the replacement insert fails (FIX-D)", () => {
    // Pre-create the target id so the swap's INSERT collides with UNIQUE.
    f.agents.create({
      id: "collide",
      name: "existing",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    f.agents.create({
      id: "to-rotate",
      name: "victim",
      status: "creating",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    expect(() =>
      f.agents.swapId("to-rotate", {
        id: "collide",
        name: "victim",
        status: "active",
        mode: "local",
        modelId: "composer-2-5-fast",
      }),
    ).toThrow();
    // Original row should still exist — transaction rolled back the DELETE.
    expect(f.agents.getById("to-rotate")).not.toBeNull();
    expect(f.agents.getById("collide")?.name).toBe("existing");
  });

  it("start() recovers a wedged persisted run by retrying once with local.force (R-W)", async () => {
    // Reproduces the "Agent <id> already has active run" toast on a fresh
    // app: the SDK's durable active_run_id (in ~/.cursor) is left wedged
    // after a crash/kill mid-run. A local agent should self-heal by
    // expire-and-retrying via SendOptions.local.force.
    const { adapter, sends } = wedgedThenOkAdapter(f.agentId);
    const { controller, runId } = await startController(adapter);
    await controller.awaitSettled();
    expect(sends).toHaveLength(2);
    expect(sends[0]?.local?.force).toBeUndefined();
    expect(sends[1]?.local?.force).toBe(true);
    expect(f.runs.getById(runId)?.status).toBe("FINISHED");
  });

  it("start() does NOT force-retry a wedged run for cloud agents (R-W)", async () => {
    // Cloud enforces its own busy-run check (409 agent_busy); a still-
    // running cloud run must never be expired out from under the user.
    const { adapter, sends } = wedgedThenOkAdapter(f.agentId);
    await expect(startController(adapter, { mode: "cloud" })).rejects.toThrow(
      /already has active run/,
    );
    expect(sends).toHaveLength(1);
  });

  it("start() does NOT retry on a non-wedged send failure (R-W)", async () => {
    // Only the specific wedged-run error triggers the force recovery; any
    // other failure must surface unchanged after a single attempt.
    const sends: SendOptions[] = [];
    const adapter: SdkAdapter = {
      async createAgent() {
        return new StubSDKAgent(f.agentId);
      },
      async resumeAgent() {
        return new StubSDKAgent(f.agentId);
      },
      async send(_agent, _message, sendOptions) {
        sends.push(sendOptions);
        throw new Error("boom: unrelated network failure");
      },
    };
    await expect(startController(adapter)).rejects.toThrow(/boom/);
    expect(sends).toHaveLength(1);
  });

  it("persists last-turn usage as context occupancy, distinct from the summed billing total", async () => {
    // Two turns: the second's input collapses (Composer self-summarized).
    // Billing input = 50k + 8k = 58k (summed); occupancy = last turn = 8k.
    const turns = [
      { inputTokens: 50_000, outputTokens: 10_000 },
      { inputTokens: 8_000, outputTokens: 2_000 },
    ];
    const adapter: SdkAdapter = {
      async createAgent() {
        return new StubSDKAgent(f.agentId);
      },
      async resumeAgent() {
        return new StubSDKAgent(f.agentId);
      },
      async send(_agent, _message, sendOptions) {
        return new StubRun(
          {
            runId: sendOptions.idempotencyKey ?? "stub",
            agentId: f.agentId,
            events: [],
            deltasOnce: turns.map((t) => ({
              type: "turn-ended",
              usage: { inputTokens: t.inputTokens, outputTokens: t.outputTokens },
            })),
            finalResult: { status: "finished", durationMs: 5 },
          },
          sendOptions.onDelta,
        );
      },
    };
    const { controller, runId } = await startController(adapter);
    await controller.awaitSettled();
    const row = f.runs.getById(runId);
    expect(row?.status).toBe("FINISHED");
    // Billing totals are summed across turns.
    expect(row?.inputTokens).toBe(58_000);
    expect(row?.outputTokens).toBe(12_000);
    // Context occupancy is the LAST turn only — the self-summary drop.
    expect(row?.lastTurnInputTokens).toBe(8_000);
    expect(row?.lastTurnOutputTokens).toBe(2_000);
  });
});
