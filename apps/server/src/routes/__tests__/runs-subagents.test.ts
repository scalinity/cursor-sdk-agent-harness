import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  subagentListResponseSchema,
  type TokenUsage,
} from "@harness/shared";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import type { RunsRoutesDeps } from "../runs.routes.js";
import { registerRunsRoutes } from "../runs.routes.js";

function createAgent(repos: Repositories) {
  return repos.agents.create({
    name: "Parent Agent",
    status: "active",
    mode: "local",
    modelId: "composer-2-5-fast",
  });
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

function finishRun(repos: Repositories, runId: string, usage: TokenUsage): void {
  repos.runs.finalize(runId, {
    status: "FINISHED",
    finalText: null,
    finalResult: { status: "FINISHED" },
    gitMetadata: null,
    durationMs: 42,
    usage,
    lastTurnInputTokens: null,
    lastTurnOutputTokens: null,
  });
}

describe("GET /api/runs/:runId/subagents", () => {
  it("lists child runs with active/completed counts and token totals", async () => {
    const db = openTestDb({ skipSeed: false });
    const repos = createRepositories(db.raw);
    const agent = createAgent(repos);
    const parent = repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "Coordinate reviewers",
      modelId: "composer-2-5-fast",
      mode: "local",
    });
    const running = repos.runs.create({
      id: "subagent-running",
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "Subagent: Reviewer A",
      name: "Reviewer A",
      parentRunId: parent.id,
      modelId: "composer-2-5-fast",
      mode: "local",
    });
    const completed = repos.runs.create({
      id: "subagent-complete",
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "Subagent: Reviewer B",
      name: "Reviewer B",
      parentRunId: parent.id,
      modelId: "composer-2-5-fast",
      mode: "local",
    });
    finishRun(repos, completed.id, {
      input_tokens: 120,
      output_tokens: 45,
      cached_input_tokens: null,
      reasoning_tokens: null,
      cost_usd_micros: 900,
      usage_source: "sdk_final_result",
    });

    const app = await buildRunsApp(repos);
    const res = await app.inject({ method: "GET", url: `/api/runs/${parent.id}/subagents` });

    expect(res.statusCode).toBe(200);
    const parsed = subagentListResponseSchema.parse(res.json());
    expect(parsed.activeCount).toBe(1);
    expect(parsed.completedCount).toBe(1);
    expect(parsed.subagents).toEqual([
      expect.objectContaining({
        runId: running.id,
        name: "Reviewer A",
        status: "RUNNING",
        completedAt: null,
        tokenCount: 0,
        costMicros: null,
      }),
      expect.objectContaining({
        runId: completed.id,
        name: "Reviewer B",
        status: "FINISHED",
        tokenCount: 165,
        costMicros: 900,
      }),
    ]);

    await app.close();
    db.close();
  });

  it("keeps child runs out of top-level surfaces and deletes them with the parent", async () => {
    const db = openTestDb({ skipSeed: false });
    const repos = createRepositories(db.raw);
    const agent = createAgent(repos);
    const parent = repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "Coordinate reviewers",
      modelId: "composer-2-5-fast",
      mode: "local",
    });
    const child = repos.runs.create({
      id: "subagent-hidden",
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "Subagent: Reviewer Hidden",
      name: "Reviewer Hidden",
      parentRunId: parent.id,
      modelId: "composer-2-5-fast",
      mode: "local",
    });

    finishRun(repos, parent.id, {
      input_tokens: 10,
      output_tokens: 5,
      cached_input_tokens: null,
      reasoning_tokens: null,
      cost_usd_micros: 100,
      usage_source: "sdk_final_result",
    });
    finishRun(repos, child.id, {
      input_tokens: 100,
      output_tokens: 50,
      cached_input_tokens: null,
      reasoning_tokens: null,
      cost_usd_micros: 900,
      usage_source: "sdk_final_result",
    });

    expect(repos.runs.count()).toBe(1);
    expect(repos.runs.list().map((run) => run.id)).toEqual([parent.id]);
    expect(repos.runs.listHistory().items.map((run) => run.id)).toEqual([parent.id]);
    expect(repos.runs.search("Reviewer Hidden", 10)).toEqual([]);
    expect(repos.runs.usageSummary().totalRuns).toBe(1);
    expect(repos.runs.usageSummary().totalTokens).toBe(15);
    expect(repos.runs.aggregatesForAgent(agent.id)).toMatchObject({
      runCount: 1,
      totalInputTokens: 10,
      totalOutputTokens: 5,
    });

    const app = await buildRunsApp(repos);
    const res = await app.inject({ method: "DELETE", url: `/api/runs/${parent.id}` });

    expect(res.statusCode).toBe(204);
    expect(repos.runs.getById(parent.id)).toBeNull();
    expect(repos.runs.getById(child.id)).toBeNull();

    await app.close();
    db.close();
  });
});
