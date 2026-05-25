import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { createPersistAndBroadcast } from "../../sdk/persist-and-broadcast.js";
import { createRunBus } from "../../ws/index.js";
import { ProviderRunController } from "../provider-run.js";
import type { ModelProvider, ProviderEvent } from "../provider.js";

class ScriptedProvider implements ModelProvider {
  readonly id = "p1";
  readonly kind = "anthropic";
  readonly name = "Scripted";
  constructor(private readonly script: ProviderEvent[]) {}
  async *sendMessage(): AsyncIterable<ProviderEvent> {
    for (const ev of this.script) yield ev;
  }
  listModels() {
    return Promise.resolve([]);
  }
}

describe("ProviderRunController", () => {
  let db: ReturnType<typeof openTestDb> | null = null;
  const logger = Fastify({ logger: false }).log;
  afterEach(() => {
    db?.close();
    db = null;
  });

  function rows(runId: string): Array<{ kind: string; payload_json: string }> {
    return db!.raw
      .prepare("SELECT kind, payload_json FROM events WHERE run_id = ? ORDER BY seq")
      .all(runId) as Array<{ kind: string; payload_json: string }>;
  }

  it("emits canonical events from provider events and finalizes the run", async () => {
    db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const bus = createRunBus();
    const pipeline = createPersistAndBroadcast({ events: repos.events, bus, logger });

    const agent = repos.agents.create({
      name: "Provider Agent",
      status: "active",
      mode: "local",
      modelId: "p1:claude-sonnet-4-5",
      cwd: null,
      settingSources: null,
      sandboxEnabled: null,
      cloudOptions: null,
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    const run = repos.runs.create({
      id: "11111111-1111-4111-8111-111111111111",
      agentId: agent.id,
      status: "CREATING",
      promptPreview: "hi",
      modelId: "p1:claude-sonnet-4-5",
      mode: "local",
      executionMode: "ask",
      workspaceId: null,
      contextMetadata: null,
    });

    const provider = new ScriptedProvider([
      { type: "text_delta", content: "Hello " },
      { type: "text_delta", content: "world" },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
      { type: "done" },
    ]);

    const controller = new ProviderRunController(
      {
        runId: run.id,
        agentId: agent.id,
        modelName: "claude-sonnet-4-5",
        prompt: "hi",
        provider,
        pricing: { inputPerMillionMicros: 1_000_000, outputPerMillionMicros: 5_000_000 },
        runsRepo: repos.runs,
        pipeline,
        logger,
      },
      () => {},
    );
    controller.start();
    await controller.awaitSettled();

    const kinds = rows(run.id).map((r) => r.kind);
    expect(kinds).toContain("system.init");
    expect(kinds.filter((k) => k === "assistant.delta").length).toBeGreaterThanOrEqual(2);
    expect(kinds).toContain("status.changed");

    const finalized = repos.runs.getById(run.id);
    expect(finalized?.status).toBe("FINISHED");
    expect(finalized?.finalText).toBe("Hello world");
    expect(finalized?.inputTokens).toBe(10);
    expect(finalized?.outputTokens).toBe(5);
    // 10/1e6*1e6 + 5/1e6*5e6 = 10 + 25 = 35 micro-USD
    expect(finalized?.costUsdMicros).toBe(35);
    expect(finalized?.usageSource).toBe("sdk_final_result");
  });

  it("marks the run errored when the provider yields an error", async () => {
    db = openTestDb({ skipSeed: true });
    const repos = createRepositories(db.raw);
    const bus = createRunBus();
    const pipeline = createPersistAndBroadcast({ events: repos.events, bus, logger });
    const agent = repos.agents.create({
      name: "A",
      status: "active",
      mode: "local",
      modelId: "p1:gpt-5",
      cwd: null,
      settingSources: null,
      sandboxEnabled: null,
      cloudOptions: null,
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    const run = repos.runs.create({
      id: "22222222-2222-4222-8222-222222222222",
      agentId: agent.id,
      status: "CREATING",
      promptPreview: "hi",
      modelId: "p1:gpt-5",
      mode: "local",
      executionMode: "ask",
      workspaceId: null,
      contextMetadata: null,
    });
    const provider = new ScriptedProvider([{ type: "error", message: "boom" }]);
    const controller = new ProviderRunController(
      {
        runId: run.id,
        agentId: agent.id,
        modelName: "gpt-5",
        prompt: "hi",
        provider,
        runsRepo: repos.runs,
        pipeline,
        logger,
      },
      () => {},
    );
    controller.start();
    await controller.awaitSettled();
    expect(repos.runs.getById(run.id)?.status).toBe("ERROR");
  });
});
