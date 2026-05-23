import { afterEach, describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { createRepositories } from "../repositories/index.js";
import type { DbClient } from "../client.js";

let client: DbClient | null = null;

afterEach(() => {
  if (client) {
    client.close();
    client = null;
  }
});

function setup() {
  client = openTestDb({ skipSeed: true });
  return createRepositories(client.raw);
}

describe("AgentsRepo + RunsRepo + EventsRepo", () => {
  it("creates agents, runs, and events and round-trips JSON columns", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Test Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      cwd: ["/tmp/workspace-a"],
      settingSources: ["project", "user"],
      sandboxEnabled: true,
      mcpServerIds: ["mcp-1", "mcp-2"],
      subagentDefinitionIds: [],
    });
    expect(agent.cwd).toEqual(["/tmp/workspace-a"]);
    expect(agent.mcpServerIds).toEqual(["mcp-1", "mcp-2"]);
    expect(agent.sandboxEnabled).toBe(true);
    expect(agent.cloudOptions).toBeNull();

    const run = repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "hello world",
      modelId: "composer-2-5-fast",
      mode: "local",
    });
    expect(run.lastSeq).toBe(0);
    expect(run.status).toBe("RUNNING");

    const appended = repos.events.appendCanonicalEvent({
      runId: run.id,
      agentId: agent.id,
      sdkType: "user",
      kind: "user.message",
      payload: {
        role: "user",
        content: [{ type: "text", text: "hi" }],
      },
      raw: { type: "user", agent_id: agent.id, run_id: run.id, message: {} },
      occurredAt: new Date().toISOString(),
    });
    expect(appended.seq).toBe(1);
    expect(appended.payloadBytes).toBeGreaterThan(0);
    expect(appended.rawBytes).toBeGreaterThan(0);

    const reloaded = repos.runs.getById(run.id);
    expect(reloaded?.lastSeq).toBe(1);

    const fetched = repos.events.getById(appended.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.runId).toBe(run.id);
    expect(fetched?.payload).toEqual({
      role: "user",
      content: [{ type: "text", text: "hi" }],
    });
  });

  it("CHECK constraint rejects unknown sdk_type", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "RUNNING" });

    expect(() =>
      repos.events.appendCanonicalEvent({
        runId: run.id,
        agentId: agent.id,
        // @ts-expect-error — verifying the SQL CHECK rejects unknown sdk_type literals.
        sdkType: "nonsense",
        kind: "anything",
        payload: { ok: true },
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow(/CHECK constraint failed/i);
  });

  it("CHECK constraint rejects malformed JSON in payload_json", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "RUNNING" });

    expect(() =>
      client!.raw
        .prepare(
          `INSERT INTO events (
              id, run_id, agent_id, seq, sdk_type, kind,
              payload_json, occurred_at, received_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "00000000-0000-0000-0000-000000000001",
          run.id,
          agent.id,
          1,
          "user",
          "user.message",
          "not-json",
          new Date().toISOString(),
          new Date().toISOString(),
        ),
    ).toThrow(/CHECK constraint failed/i);
  });

  it("agent delete cascades to runs and events", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "RUNNING" });
    repos.events.appendCanonicalEvent({
      runId: run.id,
      agentId: agent.id,
      sdkType: "user",
      kind: "user.message",
      payload: { role: "user", content: [] },
      occurredAt: new Date().toISOString(),
    });

    repos.agents.delete(agent.id);

    const runRow = client!.raw
      .prepare("SELECT COUNT(*) AS c FROM runs WHERE id = ?")
      .get(run.id) as { c: number };
    const eventRow = client!.raw
      .prepare("SELECT COUNT(*) AS c FROM events WHERE run_id = ?")
      .get(run.id) as { c: number };
    expect(runRow.c).toBe(0);
    expect(eventRow.c).toBe(0);
  });

  it("appendCanonicalEvent produces gapless sequences across many sequential calls", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "RUNNING" });

    const seqs: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const ev = repos.events.appendCanonicalEvent({
        runId: run.id,
        agentId: agent.id,
        sdkType: "assistant",
        kind: "assistant.delta",
        payload: { i },
        occurredAt: new Date().toISOString(),
      });
      seqs.push(ev.seq);
    }
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

    const reloaded = repos.runs.getById(run.id);
    expect(reloaded?.lastSeq).toBe(50);
  });

  it("UNIQUE(run_id, seq) prevents duplicate seq inserts", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "RUNNING" });

    repos.events.appendCanonicalEvent({
      runId: run.id,
      agentId: agent.id,
      sdkType: "user",
      kind: "user.message",
      payload: {},
      occurredAt: new Date().toISOString(),
    });

    expect(() =>
      client!.raw
        .prepare(
          `INSERT INTO events (
              id, run_id, agent_id, seq, sdk_type, kind, payload_json, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "00000000-0000-0000-0000-000000000aaa",
          run.id,
          agent.id,
          1,
          "user",
          "user.message",
          "{}",
          new Date().toISOString(),
        ),
    ).toThrow(/UNIQUE/i);
  });

  it("setUsage and setFinalResult round-trip", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "FINISHED" });

    repos.runs.setUsage(run.id, {
      input_tokens: 100,
      output_tokens: 250,
      cached_input_tokens: 20,
      reasoning_tokens: null,
      cost_usd_micros: 4_200,
      usage_source: "sdk_final_result",
    });
    repos.runs.setFinalResult(run.id, {
      finalText: "ok",
      finalResult: { id: "run-1", status: "FINISHED" },
      gitMetadata: null,
      durationMs: 1234,
    });

    const reloaded = repos.runs.getById(run.id);
    expect(reloaded?.inputTokens).toBe(100);
    expect(reloaded?.costUsdMicros).toBe(4_200);
    expect(reloaded?.usageSource).toBe("sdk_final_result");
    expect(reloaded?.finalText).toBe("ok");
    expect(reloaded?.finalResult).toEqual({ id: "run-1", status: "FINISHED" });
    expect(reloaded?.durationMs).toBe(1234);
  });

  it("setInterrupted marks active runs as ERROR and is a no-op on terminal runs", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const running = repos.runs.create({ agentId: agent.id, status: "RUNNING" });
    const done = repos.runs.create({ agentId: agent.id, status: "FINISHED" });

    repos.runs.setInterrupted(running.id, "server_restart", "process died");
    repos.runs.setInterrupted(done.id, "server_restart", "should be ignored");

    const r = repos.runs.getById(running.id);
    const d = repos.runs.getById(done.id);
    expect(r?.status).toBe("ERROR");
    expect(r?.interruptedReason).toBe("server_restart");
    expect(r?.error).toEqual({ message: "process died" });
    // FINISHED run must be untouched — no status change, no interrupted_reason,
    // no error_json. Spec §11 marks ONLY non-terminal runs.
    expect(d?.status).toBe("FINISHED");
    expect(d?.interruptedReason).toBeNull();
    expect(d?.error).toBeNull();
  });
});
