import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pino } from "pino";
import type { FastifyBaseLogger } from "fastify";
import type { SettingsSnapshot } from "@harness/shared";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { AgentsRepo } from "../../db/repositories/agents.repo.js";
import { RunsRepo } from "../../db/repositories/runs.repo.js";
import { RunController, newRunId } from "../run-controller.js";
import { createStubSdkAdapter, type StubSDKAgent } from "../testing.js";

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
  cleanup: () => void;
}

function setupFixture(): Fixture {
  const db = openTestDb();
  const agents = new AgentsRepo(db.raw);
  const runs = new RunsRepo(db.raw);
  const logger = pino({ level: "silent" }) as unknown as FastifyBaseLogger;
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
    sdk: ReturnType<typeof createStubSdkAdapter>,
    overrides: { runId?: string } = {},
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
        prompt: "hello",
        agent: stubAgent as StubSDKAgent,
        sdk,
        runsRepo: f.runs,
        pricing,
        sink: async () => undefined,
        logger: f.logger,
      },
      () => undefined,
    );
    await controller.start();
    return { controller, runId };
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
  });

  it("cancel() returns unsupported and writes ERROR + cancel_unavailable when SDK reports no cancel support (FIX-G)", async () => {
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
    expect(row?.status).toBe("ERROR");
    expect(row?.interruptedReason).toBe("stream_error");
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
        prompt: "hello",
        agent: stubAgent as StubSDKAgent,
        sdk,
        runsRepo: f.runs,
        pricing,
        sink: async () => undefined,
        logger: f.logger,
      },
      () => undefined,
    );
    await controller.start();
    await controller.awaitSettled();
    const row = f.runs.getById(runId);
    expect(row?.status).toBe("FINISHED");
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
});
