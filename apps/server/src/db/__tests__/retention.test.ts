import { afterEach, describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { createRepositories } from "../repositories/index.js";
import { pruneRawEventJson } from "../retention.js";
import type { DbClient } from "../client.js";

let client: DbClient | null = null;

afterEach(() => {
  if (client) {
    client.close();
    client = null;
  }
});

describe("retention.pruneRawEventJson", () => {
  it("nulls raw_json on terminal-run events older than rawEventRetentionDays", () => {
    client = openTestDb();
    const repos = createRepositories(client.raw);
    // Shorten retention so we can use a small time offset.
    repos.settings.set("rawEventRetentionDays", 1);

    const agent = repos.agents.create({
      name: "A",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const finishedRun = repos.runs.create({
      agentId: agent.id,
      status: "FINISHED",
    });
    const runningRun = repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
    });

    // Insert two old events on the FINISHED run and one old event on the RUNNING run.
    // We override created_at directly to simulate aged rows.
    const oldIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    function ageRow(eventId: string): void {
      client!.raw
        .prepare("UPDATE events SET created_at = ? WHERE id = ?")
        .run(oldIso, eventId);
    }

    const e1 = repos.events.appendCanonicalEvent({
      runId: finishedRun.id,
      agentId: agent.id,
      sdkType: "assistant",
      kind: "assistant.delta",
      payload: { text: "a" },
      raw: { type: "assistant", agent_id: agent.id, run_id: finishedRun.id, message: {} },
      occurredAt: oldIso,
    });
    const e2 = repos.events.appendCanonicalEvent({
      runId: finishedRun.id,
      agentId: agent.id,
      sdkType: "assistant",
      kind: "assistant.delta",
      payload: { text: "b" },
      raw: { type: "assistant" },
      occurredAt: oldIso,
    });
    const e3 = repos.events.appendCanonicalEvent({
      runId: runningRun.id,
      agentId: agent.id,
      sdkType: "assistant",
      kind: "assistant.delta",
      payload: { text: "c" },
      raw: { type: "assistant" },
      occurredAt: oldIso,
    });
    ageRow(e1.id);
    ageRow(e2.id);
    ageRow(e3.id);

    const result = pruneRawEventJson(client!.raw, new Date());
    expect(result.prunedCount).toBe(2);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    // FINISHED run events should have raw_json nulled.
    const finishedRows = client!.raw
      .prepare("SELECT raw_json FROM events WHERE run_id = ?")
      .all(finishedRun.id) as { raw_json: string | null }[];
    expect(finishedRows.every((row) => row.raw_json === null)).toBe(true);

    // RUNNING run event should still have raw_json present.
    const runningRow = client!.raw
      .prepare("SELECT raw_json FROM events WHERE id = ?")
      .get(e3.id) as { raw_json: string | null };
    expect(runningRow.raw_json).not.toBeNull();
  });

  it("preserves canonical payload_json (never deletes events)", () => {
    client = openTestDb();
    const repos = createRepositories(client.raw);
    repos.settings.set("rawEventRetentionDays", 1);
    const agent = repos.agents.create({
      name: "A",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
    });
    const run = repos.runs.create({ agentId: agent.id, status: "FINISHED" });
    const oldIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const e = repos.events.appendCanonicalEvent({
      runId: run.id,
      agentId: agent.id,
      sdkType: "assistant",
      kind: "assistant.delta",
      payload: { text: "keep me" },
      raw: { type: "assistant" },
      occurredAt: oldIso,
    });
    client!.raw
      .prepare("UPDATE events SET created_at = ? WHERE id = ?")
      .run(oldIso, e.id);

    pruneRawEventJson(client!.raw, new Date());

    const row = client!.raw
      .prepare("SELECT payload_json FROM events WHERE id = ?")
      .get(e.id) as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toEqual({ text: "keep me" });
  });
});
