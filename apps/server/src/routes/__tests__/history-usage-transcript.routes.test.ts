import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import {
  getRunEventsResponseSchema,
  listRunsResponseSchema,
  transcriptResponseSchema,
  usageBreakdownResponseSchema,
  usageDailyResponseSchema,
  usageSummaryResponseSchema,
} from "@harness/shared";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import type { RunsRoutesDeps } from "../runs.routes.js";
import { registerRunsRoutes } from "../runs.routes.js";
import { registerUsageRoutes } from "../usage.routes.js";

function iso(hour: number): string {
  return `2026-05-20T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function createAgent(repos: Repositories, name: string) {
  return repos.agents.create({
    name,
    status: "active",
    mode: "local",
    modelId: "composer-2-5-fast",
  });
}

function createRunFixture(
  raw: BetterSqlite3Database,
  repos: Repositories,
  input: {
    agentId: string;
    status: "FINISHED" | "ERROR" | "RUNNING";
    promptPreview: string;
    modelId: string;
    startedAt: string;
    durationMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
    costUsdMicros: number | null;
    usageSource: "sdk_final_result" | "unavailable";
    finalText?: string | null;
  },
): string {
  const run = repos.runs.create({
    agentId: input.agentId,
    status: "RUNNING",
    promptPreview: input.promptPreview,
    modelId: input.modelId,
    mode: "local",
  });
  repos.runs.finalize(run.id, {
    status: input.status,
    finalText: input.finalText ?? null,
    finalResult: { id: run.id, status: input.status.toLowerCase() },
    gitMetadata: { branches: [] },
    durationMs: input.durationMs,
    usage: {
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cached_input_tokens: input.cachedInputTokens,
      reasoning_tokens: null,
      cost_usd_micros: input.costUsdMicros,
      usage_source: input.usageSource,
    },
  });
  raw
    .prepare("UPDATE runs SET started_at = ?, finished_at = ? WHERE id = ?")
    .run(input.startedAt, input.status === "RUNNING" ? null : input.startedAt, run.id);
  return run.id;
}

async function buildRunsApp(repos: Repositories) {
  const app = Fastify({ logger: false });
  await registerRunsRoutes(app, {
    runsRepo: repos.runs,
    eventsRepo: repos.events,
    agentsRepo: repos.agents,
    runtime: {} as RunsRoutesDeps["runtime"],
  });
  return app;
}

describe("Phase 11 run history, replay events, and transcript routes", () => {
  it("filters and sorts run history with agent names and tool-call counts", async () => {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const agent = createAgent(repos, "History Agent");
    const otherAgent = createAgent(repos, "Other Agent");
    const matchingRunId = createRunFixture(db.raw, repos, {
      agentId: agent.id,
      status: "FINISHED",
      promptPreview: "Summarize the last run",
      modelId: "composer-2-5-fast",
      startedAt: iso(10),
      durationMs: 65_000,
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      costUsdMicros: 1234,
      usageSource: "sdk_final_result",
      finalText: "Done",
    });
    createRunFixture(db.raw, repos, {
      agentId: otherAgent.id,
      status: "FINISHED",
      promptPreview: "Outside filter",
      modelId: "composer-2-5",
      startedAt: iso(8),
      durationMs: 5_000,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      costUsdMicros: null,
      usageSource: "unavailable",
    });
    repos.events.appendCanonicalEvent({
      runId: matchingRunId,
      agentId: agent.id,
      sdkType: "tool_call",
      kind: "tool_call.running",
      callId: "call-1",
      payload: { call_id: "call-1", name: "read", status: "running" },
      occurredAt: iso(10),
    });
    repos.events.appendCanonicalEvent({
      runId: matchingRunId,
      agentId: agent.id,
      sdkType: "tool_call",
      kind: "tool_call.error",
      callId: "call-1",
      status: "error",
      payload: { call_id: "call-1", name: "read", status: "error" },
      occurredAt: iso(10),
    });

    const app = await buildRunsApp(repos);
    const res = await app.inject({
      method: "GET",
      url: `/api/runs?agentId=${agent.id}&status=FINISHED&modelId=composer-2-5-fast&from=2026-05-20T00:00:00.000Z&to=2026-05-21T00:00:00.000Z&hasCost=available&sort=cost_desc&page=1&pageSize=25`,
    });

    expect(res.statusCode).toBe(200);
    const body = listRunsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: matchingRunId,
      agentName: "History Agent",
      toolCallCount: 2,
      errorToolCallCount: 1,
      costUsdMicros: 1234,
    });

    await app.close();
    db.close();
  });

  it("returns replay frames in run sequence order", async () => {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const agent = createAgent(repos, "Replay Agent");
    const runId = createRunFixture(db.raw, repos, {
      agentId: agent.id,
      status: "FINISHED",
      promptPreview: "Replay me",
      modelId: "composer-2-5-fast",
      startedAt: iso(11),
      durationMs: 1000,
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      costUsdMicros: 1,
      usageSource: "sdk_final_result",
      finalText: "Hello",
    });
    repos.events.appendCanonicalEvent({
      runId,
      agentId: agent.id,
      sdkType: "user",
      kind: "user.message",
      payload: { role: "user", content: [{ type: "text", text: "Hi" }] },
      occurredAt: iso(11),
    });
    repos.events.appendCanonicalEvent({
      runId,
      agentId: agent.id,
      sdkType: "assistant",
      kind: "assistant.delta",
      payload: { role: "assistant", text_delta: "Hello", tool_uses: [] },
      occurredAt: iso(11),
    });

    const app = await buildRunsApp(repos);
    const res = await app.inject({ method: "GET", url: `/api/runs/${runId}/events?limit=10` });

    expect(res.statusCode).toBe(200);
    const body = getRunEventsResponseSchema.parse(res.json());
    const eventFrames = body.items.filter((frame): frame is Extract<typeof frame, { event: unknown }> =>
      "event" in frame,
    );
    expect(eventFrames.map((frame) => frame.event.seq)).toEqual([1, 2]);
    expect(eventFrames.map((frame) => frame.type)).toEqual(["sdk.user", "sdk.assistant"]);
    expect(body.nextAfterSeq).toBeNull();

    await app.close();
    db.close();
  });

  it("exports transcript JSON and markdown from canonical events", async () => {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const agent = createAgent(repos, "Transcript Agent");
    const runId = createRunFixture(db.raw, repos, {
      agentId: agent.id,
      status: "FINISHED",
      promptPreview: "Export this",
      modelId: "composer-2-5-fast",
      startedAt: iso(12),
      durationMs: 2000,
      inputTokens: 12,
      outputTokens: 34,
      cachedInputTokens: 5,
      costUsdMicros: 999,
      usageSource: "sdk_final_result",
      finalText: "The answer",
    });
    repos.events.appendCanonicalEvent({
      runId,
      agentId: agent.id,
      sdkType: "assistant",
      kind: "assistant.delta",
      payload: { role: "assistant", text_delta: "The answer", tool_uses: [] },
      occurredAt: iso(12),
    });
    repos.events.appendCanonicalEvent({
      runId,
      agentId: agent.id,
      sdkType: "tool_call",
      kind: "tool_call.completed",
      callId: "tool-1",
      payload: { call_id: "tool-1", name: "read", status: "completed", args: { path: "a.ts" } },
      occurredAt: iso(12),
    });

    const app = await buildRunsApp(repos);
    const jsonRes = await app.inject({ method: "GET", url: `/api/runs/${runId}/transcript` });
    expect(jsonRes.statusCode).toBe(200);
    const transcript = transcriptResponseSchema.parse(jsonRes.json());
    expect(transcript.schemaVersion).toBe(1);
    expect(transcript.run.id).toBe(runId);
    expect(transcript.agent.name).toBe("Transcript Agent");
    expect(transcript.events).toHaveLength(2);
    expect(transcript.run.usage.cost_usd_micros).toBe(999);

    const mdRes = await app.inject({ method: "GET", url: `/api/runs/${runId}/transcript?format=markdown` });
    expect(mdRes.statusCode).toBe(200);
    expect(mdRes.headers["content-type"]).toContain("text/markdown");
    expect(mdRes.body).toContain("# Transcript: Export this");
    expect(mdRes.body).toContain("The answer");
    expect(mdRes.body).toContain("Tool call: read");

    await app.close();
    db.close();
  });

  it("rejects deleting active runs to preserve live event persistence", async () => {
    const db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const agent = createAgent(repos, "Active Agent");
    const run = repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "Still running",
      modelId: "composer-2-5-fast",
      mode: "local",
    });

    const app = await buildRunsApp(repos);
    const res = await app.inject({ method: "DELETE", url: `/api/runs/${run.id}` });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "RUN_NOT_TERMINAL" });
    expect(repos.runs.getById(run.id)).not.toBeNull();

    await app.close();
    db.close();
  });
});

describe("Phase 11 usage routes", () => {
  it("returns summary, daily, model, and agent aggregates for a date range", async () => {
    const db = openTestDb({ skipSeed: false });
    const repos = createRepositories(db.raw);
    const agent = createAgent(repos, "Usage Agent");
    createRunFixture(db.raw, repos, {
      agentId: agent.id,
      status: "FINISHED",
      promptPreview: "Costed",
      modelId: "composer-2-5-fast",
      startedAt: iso(7),
      durationMs: 1000,
      inputTokens: 200,
      outputTokens: 100,
      cachedInputTokens: 20,
      costUsdMicros: 4567,
      usageSource: "sdk_final_result",
    });
    createRunFixture(db.raw, repos, {
      agentId: agent.id,
      status: "FINISHED",
      promptPreview: "Unavailable",
      modelId: "composer-2-5-fast",
      startedAt: iso(9),
      durationMs: 1000,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      costUsdMicros: null,
      usageSource: "unavailable",
    });

    const app = Fastify({ logger: false });
    await registerUsageRoutes(app, { runsRepo: repos.runs, settingsRepo: repos.settings });
    const query = "from=2026-05-20T00:00:00.000Z&to=2026-05-21T00:00:00.000Z";

    const summary = usageSummaryResponseSchema.parse(
      (await app.inject({ method: "GET", url: `/api/usage/summary?${query}` })).json(),
    );
    expect(summary).toMatchObject({
      totalRuns: 2,
      totalCost: 4567,
      totalTokens: 300,
      unavailableCount: 1,
    });
    expect(summary.pricingFreshness.staleness).toBe("fresh");

    const daily = usageDailyResponseSchema.parse(
      (await app.inject({ method: "GET", url: `/api/usage/daily?${query}` })).json(),
    );
    expect(daily).toEqual([{ date: "2026-05-20", cost: 4567, tokens: 300 }]);

    const byModel = usageBreakdownResponseSchema.parse(
      (await app.inject({ method: "GET", url: `/api/usage/by-model?${query}` })).json(),
    );
    expect(byModel.items[0]).toMatchObject({ name: "composer-2-5-fast", runs: 2, cost: 4567, tokens: 300 });

    const byAgent = usageBreakdownResponseSchema.parse(
      (await app.inject({ method: "GET", url: `/api/usage/by-agent?${query}` })).json(),
    );
    expect(byAgent.items[0]).toMatchObject({ id: agent.id, name: "Usage Agent", runs: 2, cost: 4567, tokens: 300 });

    await app.close();
    db.close();
  });
});
