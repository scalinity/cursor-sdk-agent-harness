import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { EventRow, SDKMessage } from "@harness/shared";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { AgentsRepo } from "../../db/repositories/agents.repo.js";
import { EventsRepo } from "../../db/repositories/events.repo.js";
import { RunsRepo } from "../../db/repositories/runs.repo.js";
import { createRunBus, type RunBus } from "../../ws/run-bus.js";
import { createPersistAndBroadcast } from "../persist-and-broadcast.js";

const silentLogger = pino({ level: "silent" });

describe("persist-and-broadcast pipeline", () => {
  let dbClient: ReturnType<typeof openTestDb>;
  let raw: BetterSqlite3Database;
  let agents: AgentsRepo;
  let runs: RunsRepo;
  let events: EventsRepo;
  let bus: RunBus;
  let agentId: string;
  let runId: string;

  beforeEach(() => {
    dbClient = openTestDb();
    raw = dbClient.raw;
    agents = new AgentsRepo(raw);
    runs = new RunsRepo(raw);
    events = new EventsRepo(raw);
    bus = createRunBus();
    const agent = agents.create({
      name: "test",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      cwd: ["/tmp"],
      settingSources: ["project"],
      sandboxEnabled: true,
      cloudOptions: null,
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    agentId = agent.id;
    const run = runs.create({ agentId, status: "RUNNING", modelId: "composer-2-5-fast", mode: "local" });
    runId = run.id;
  });

  afterEach(() => {
    raw.close();
  });

  it("persists a canonical event row and broadcasts AFTER commit", async () => {
    const pipeline = createPersistAndBroadcast({ events, bus, logger: silentLogger });
    const seen: EventRow[] = [];
    bus.subscribe(runId, (e) => seen.push(e));

    const raw1: SDKMessage = {
      type: "assistant",
      agent_id: agentId,
      run_id: runId,
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    };
    pipeline.ingestSDKMessage({ raw: raw1, runId, agentId, agentMode: "local" });

    const dbRows = events.getByRunIdAfterSeq(runId, 0);
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]?.kind).toBe("assistant.delta");

    await new Promise((r) => setImmediate(r));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("assistant.delta");
    expect(seen[0]?.seq).toBe(1);
  });

  it("allocates monotonically increasing seq values per run", async () => {
    const pipeline = createPersistAndBroadcast({ events, bus, logger: silentLogger });

    for (let i = 0; i < 10; i++) {
      pipeline.ingestSDKMessage({
        raw: {
          type: "assistant",
          agent_id: agentId,
          run_id: runId,
          message: { role: "assistant", content: [{ type: "text", text: "x".repeat(i + 1) }] },
        },
        runId,
        agentId,
        agentMode: "local",
      });
    }

    const rows = events.getByRunIdAfterSeq(runId, 0, 100);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("advances the text-buffer only after the insert commits", () => {
    const pipeline = createPersistAndBroadcast({ events, bus, logger: silentLogger });
    pipeline.ingestSDKMessage({
      raw: {
        type: "assistant",
        agent_id: agentId,
        run_id: runId,
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      },
      runId,
      agentId,
      agentMode: "local",
    });
    pipeline.ingestSDKMessage({
      raw: {
        type: "assistant",
        agent_id: agentId,
        run_id: runId,
        message: { role: "assistant", content: [{ type: "text", text: "Hello, world" }] },
      },
      runId,
      agentId,
      agentMode: "local",
    });
    const rows = events.getByRunIdAfterSeq(runId, 0, 100);
    // The second event's payload should carry only the suffix delta.
    expect((rows[1]?.payload as { text_delta: string }).text_delta).toBe(", world");
  });

  it("throws and emits ZERO frames when the underlying insert fails (persist-before-broadcast)", async () => {
    const pipeline = createPersistAndBroadcast({ events, bus, logger: silentLogger });
    const seen: EventRow[] = [];
    bus.subscribe("bogus-run", (e) => seen.push(e));

    // Run id that doesn't exist — appendCanonicalEvent throws inside the txn
    // when `RETURNING last_seq` returns no row.
    expect(() => {
      pipeline.ingestSDKMessage({
        raw: {
          type: "status",
          agent_id: agentId,
          run_id: "bogus-run",
          status: "RUNNING",
        },
        runId: "bogus-run",
        agentId,
        agentMode: "local",
      });
    }).toThrow("run not found");

    await new Promise((r) => setImmediate(r));
    expect(seen).toHaveLength(0);
  });

  it("emits a code_edit.detected event after a completed edit tool_call", async () => {
    const pipeline = createPersistAndBroadcast({ events, bus, logger: silentLogger });
    const seen: EventRow[] = [];
    bus.subscribe(runId, (e) => seen.push(e));

    pipeline.ingestSDKMessage({
      raw: {
        type: "tool_call",
        agent_id: agentId,
        run_id: runId,
        call_id: "c-1",
        name: "edit",
        status: "completed",
        args: { path: "src/foo.ts" },
        result: { value: { diffString: "--- a\n+++ b\n" } },
      },
      runId,
      agentId,
      agentMode: "local",
    });
    await new Promise((r) => setImmediate(r));
    const kinds = seen.map((e) => e.kind);
    expect(kinds).toContain("tool_call.completed");
    expect(kinds).toContain("code_edit.detected");
    // Both events share the same call_id discriminator.
    const codeEdit = seen.find((e) => e.kind === "code_edit.detected");
    expect(codeEdit?.callId).toBe("c-1");
  });

  it("syncs sub-agent child runs when lifecycle events commit", async () => {
    const pipeline = createPersistAndBroadcast({ events, runs, bus, logger: silentLogger });
    const seen: EventRow[] = [];
    bus.subscribe(runId, (e) => seen.push(e));

    pipeline.ingestSDKMessage({
      raw: {
        type: "tool_call",
        agent_id: agentId,
        run_id: runId,
        call_id: "subagent-call-1",
        name: "task",
        status: "running",
        args: { subagentType: { kind: "reviewer", name: "Reviewer" } },
      },
      runId,
      agentId,
      agentMode: "local",
    });

    const rowsAfterSpawn = events.getByRunIdAfterSeq(runId, 0, 100);
    expect(rowsAfterSpawn.map((row) => row.kind)).toEqual([
      "tool_call.running",
      "subagent.spawned",
    ]);
    const child = runs.listSubagents(runId)[0];
    expect(child).toMatchObject({ name: "Reviewer", status: "RUNNING" });

    pipeline.ingestSDKMessage({
      raw: {
        type: "tool_call",
        agent_id: agentId,
        run_id: runId,
        call_id: "subagent-call-1",
        name: "task",
        status: "completed",
        args: { subagentType: { kind: "reviewer", name: "Reviewer" } },
        result: { status: "FINISHED" },
      },
      runId,
      agentId,
      agentMode: "local",
    });

    expect(runs.listSubagents(runId)[0]).toMatchObject({
      name: "Reviewer",
      status: "FINISHED",
    });

    await new Promise((r) => setImmediate(r));
    expect(seen.map((row) => row.kind)).toEqual([
      "tool_call.running",
      "subagent.spawned",
      "tool_call.completed",
      "subagent.completed",
    ]);
  });

  it("LRU-evicts the oldest buffer when capacity is reached", () => {
    const pipeline = createPersistAndBroadcast(
      { events, bus, logger: silentLogger },
      { bufferCapacity: 2 },
    );
    // Create two more runs so we have three distinct runIds in play. We
    // can't use the same runId across all three calls because seq would
    // overflow into another agent's events, and the second run we create
    // needs its own runId so the eviction test exercises distinct keys.
    const runB = runs.create({ agentId, status: "RUNNING", modelId: "composer-2-5-fast", mode: "local" });
    const runC = runs.create({ agentId, status: "RUNNING", modelId: "composer-2-5-fast", mode: "local" });

    pipeline.ingestSDKMessage({
      raw: { type: "assistant", agent_id: agentId, run_id: runId, message: { role: "assistant", content: [{ type: "text", text: "A" }] } },
      runId,
      agentId,
      agentMode: "local",
    });
    pipeline.ingestSDKMessage({
      raw: { type: "assistant", agent_id: agentId, run_id: runB.id, message: { role: "assistant", content: [{ type: "text", text: "B" }] } },
      runId: runB.id,
      agentId,
      agentMode: "local",
    });
    expect(pipeline.bufferCount()).toBe(2);
    // Third runId should evict the oldest (runId).
    pipeline.ingestSDKMessage({
      raw: { type: "assistant", agent_id: agentId, run_id: runC.id, message: { role: "assistant", content: [{ type: "text", text: "C" }] } },
      runId: runC.id,
      agentId,
      agentMode: "local",
    });
    expect(pipeline.bufferCount()).toBe(2);
  });

  it("persists unknown SDK shapes as system.unknown_sdk_message without broadcasting", async () => {
    const pipeline = createPersistAndBroadcast({ events, bus, logger: silentLogger });
    const seen: EventRow[] = [];
    bus.subscribe(runId, (e) => seen.push(e));

    pipeline.ingestUnknownSDKMessage({
      raw: { type: "future_event_type_not_in_union", weird_field: 42 },
      runId,
      agentId,
      parseError: new Error("test parse error"),
    });

    const rows = events.getByRunIdAfterSeq(runId, 0, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("system.unknown_sdk_message");
    expect(rows[0]?.sdkType).toBe("system");
    expect(rows[0]?.raw).toEqual({
      type: "future_event_type_not_in_union",
      weird_field: 42,
    });

    // No live broadcast for unknown kinds — frame-builder returns null
    // and persist-and-broadcast doesn't publish from this path. Subscribers
    // get nothing.
    await new Promise((r) => setImmediate(r));
    expect(seen).toHaveLength(0);
  });

  it("dropRun forgets the text buffer so a recycled runId starts fresh", () => {
    const pipeline = createPersistAndBroadcast({ events, bus, logger: silentLogger });
    pipeline.ingestSDKMessage({
      raw: {
        type: "assistant",
        agent_id: agentId,
        run_id: runId,
        message: { role: "assistant", content: [{ type: "text", text: "abc" }] },
      },
      runId,
      agentId,
      agentMode: "local",
    });
    pipeline.dropRun(runId);
    pipeline.ingestSDKMessage({
      raw: {
        type: "assistant",
        agent_id: agentId,
        run_id: runId,
        message: { role: "assistant", content: [{ type: "text", text: "abcdef" }] },
      },
      runId,
      agentId,
      agentMode: "local",
    });
    // Without the drop, the second event would have been a "def" delta. With
    // the drop, it's a fresh delta of the entire string.
    const rows = events.getByRunIdAfterSeq(runId, 0, 100);
    expect((rows[1]?.payload as { text_delta: string }).text_delta).toBe("abcdef");
  });
});
