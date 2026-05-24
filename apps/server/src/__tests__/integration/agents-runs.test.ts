import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { SdkImage } from "@harness/shared";
import { buildApp } from "../../app.js";
import { loadEnv } from "../../config/env.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { CsrfSecretStore, CursorApiKeyStore } from "../../keychain/index.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../../keychain/testing.js";
import { createStubSdkAdapter, StubRun, StubSDKAgent } from "../../sdk/testing.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-test",
  ALLOW_REMOTE_BIND: "false",
};

interface Harness {
  app: FastifyInstance;
  close: () => Promise<void>;
  allowedDir: string;
  tmpDir: string;
  csrfToken: () => Promise<string>;
  sends: Array<{ prompt: string; images?: SdkImage[] }>;
}

interface BuildHarnessOptions {
  sdkOverride?: ReturnType<typeof createStubSdkAdapter>;
}

async function buildHarness(options?: BuildHarnessOptions): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-ar-"));
  const allowedDir = path.join(tmpDir, "ws");
  await fs.mkdir(allowedDir);
  const realAllowed = await fs.realpath(allowedDir);

  const env = loadEnv(BASE_ENV);
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  repos.workspaceAllowlist.create({ path: realAllowed, recursive: true });

  const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
  await apiKeyStore.setApiKey("sk-test-12345678");

  const sends: Array<{ prompt: string; images?: SdkImage[] }> = [];
  const sdk = options?.sdkOverride ?? createStubSdkAdapter({
    onSend: ({ agent, prompt, images, idempotencyKey }) => {
      void prompt;
      sends.push({ prompt, ...(images ? { images } : {}) });
      return {
        runId: idempotencyKey ?? `stub-${prompt.length}`,
        agentId: agent.agentId,
        deltasOnce: [
          {
            type: "turn-ended",
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          },
        ],
        events: [
          { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "RUNNING" },
          {
            type: "assistant",
            agent_id: agent.agentId,
            run_id: idempotencyKey,
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hi" }],
            },
          },
          { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "FINISHED" },
        ],
        finalResult: { status: "finished", result: "hi", durationMs: 12 },
      };
    },
  });

  const { app } = await buildApp({
    env,
    repos,
    apiKeyStore,
    csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
    sdk,
  });

  return {
    app,
    allowedDir: realAllowed,
    tmpDir,
    sends,
    close: async () => {
      await app.close();
      dbClient.raw.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    csrfToken: async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/security/csrf-token",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      return (res.json() as { token: string }).token;
    },
  };
}

describe("agents + runs REST routes", () => {
  let h: Harness;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    await h?.close();
    resetKeychainDriverForTests();
  });

  it("POST /api/agents creates an agent and persists it", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "first agent",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        sandboxEnabled: true,
        settingSources: ["project"],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string };
    expect(body.id).toBeTypeOf("string");
    expect(body.status).toBe("active");

    const list = await h.app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBe(1);
  });

  it("POST /api/agents returns 403 WORKSPACE_REJECTED for a non-allowlisted cwd", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "harness-outside-"));
    try {
      const res = await h.app.inject({
        method: "POST",
        url: "/api/agents",
        payload: {
          name: "evil agent",
          mode: "local",
          modelId: "composer-2-5-fast",
          cwd: [outside],
          mcpServerIds: [],
          subagentDefinitionIds: [],
        },
        headers: {
          origin: "http://127.0.0.1:5173",
          "x-csrf-token": token,
          "content-type": "application/json",
        },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { code: string }).code).toBe("WORKSPACE_REJECTED");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("POST /api/agents returns 412 MISSING_API_KEY when no key is configured", async () => {
    h = await buildHarness();
    // Delete the pre-seeded key
    const env = loadEnv(BASE_ENV);
    const store = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
    await store.deleteApiKey();

    const token = await h.csrfToken();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "keyless",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(412);
    expect((res.json() as { code: string }).code).toBe("MISSING_API_KEY");
  });

  it("POST /api/runs registers a controller, the run finishes, usage persists", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();

    const create = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "run-test",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(create.statusCode).toBe(201);
    const agentId = (create.json() as { id: string }).id;

    const runRes = await h.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { agentId, prompt: "hello world" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(runRes.statusCode).toBe(201);
    const runBody = runRes.json() as { runId: string; status: string };
    expect(runBody.runId).toBeTypeOf("string");

    // Let the consume loop finish.
    await new Promise((r) => setTimeout(r, 80));

    const detail = await h.app.inject({
      method: "GET",
      url: `/api/runs/${runBody.runId}`,
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(detail.statusCode).toBe(200);
    const final = detail.json() as {
      status: string;
      inputTokens: number | null;
      outputTokens: number | null;
      costUsdMicros: number | null;
      usageSource: string | null;
    };
    expect(final.status).toBe("FINISHED");
    expect(final.inputTokens).toBe(100);
    expect(final.outputTokens).toBe(50);
    expect(final.usageSource).toBe("sdk_final_result");
  });

  it("POST /api/runs forwards image attachments to agent.send", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();

    const create = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "image-run-test",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(create.statusCode).toBe(201);
    const agentId = (create.json() as { id: string }).id;

    const image: SdkImage = { data: "aGVsbG8=", mimeType: "image/png" };
    const runRes = await h.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { agentId, prompt: "describe this image", images: [image] },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(runRes.statusCode).toBe(201);

    // Let the consume loop finish.
    await new Promise((r) => setTimeout(r, 80));

    // The image attachment reached agent.send as an SDKUserMessage.
    expect(h.sends.length).toBeGreaterThan(0);
    expect(h.sends[0]?.prompt).toBe("describe this image");
    expect(h.sends[0]?.images).toEqual([image]);
  });

  it("POST /api/agents/:id/terminate flips the agent status to terminated", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();

    const create = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "tear-down",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const agentId = (create.json() as { id: string }).id;

    const term = await h.app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/terminate`,
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
      },
    });
    expect(term.statusCode).toBe(200);

    const detail = await h.app.inject({
      method: "GET",
      url: `/api/agents/${agentId}`,
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect((detail.json() as { status: string }).status).toBe("terminated");
  });

  it("POST /api/runs returns 409 AGENT_TERMINATED when the agent is terminated", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();
    const create = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "terminated",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const agentId = (create.json() as { id: string }).id;
    await h.app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/terminate`,
      headers: { origin: "http://127.0.0.1:5173", "x-csrf-token": token },
    });
    const runRes = await h.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { agentId, prompt: "ping" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(runRes.statusCode).toBe(409);
    expect((runRes.json() as { code: string }).code).toBe("AGENT_TERMINATED");
  });

  it("POST /api/agents/:id/resume reactivates a terminated agent", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();
    const create = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "resumable",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const agentId = (create.json() as { id: string }).id;
    await h.app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/terminate`,
      headers: { origin: "http://127.0.0.1:5173", "x-csrf-token": token },
    });
    const resume = await h.app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/resume`,
      headers: { origin: "http://127.0.0.1:5173", "x-csrf-token": token },
    });
    expect(resume.statusCode).toBe(200);
    expect((resume.json() as { status: string }).status).toBe("active");
  });

  it("PATCH /api/agents/:id switches the agent model and persists it", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();
    const create = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "model-switch",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const agentId = (create.json() as { id: string }).id;

    const patch = await h.app.inject({
      method: "PATCH",
      url: `/api/agents/${agentId}`,
      payload: { modelId: "composer-2-5" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { modelId: string }).modelId).toBe("composer-2-5");

    const detail = await h.app.inject({
      method: "GET",
      url: `/api/agents/${agentId}`,
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect((detail.json() as { modelId: string }).modelId).toBe("composer-2-5");
  });

  it("PATCH /api/agents/:id returns 422 when no supported update is provided", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();
    const create = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "no-model-patch",
        mode: "local",
        modelId: "composer-2-5-fast",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const agentId = (create.json() as { id: string }).id;
    const patch = await h.app.inject({
      method: "PATCH",
      url: `/api/agents/${agentId}`,
      payload: {},
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(patch.statusCode).toBe(422);
  });

  it("PATCH /api/agents/:id returns 404 for an unknown agent", async () => {
    h = await buildHarness();
    const token = await h.csrfToken();
    const patch = await h.app.inject({
      method: "PATCH",
      url: "/api/agents/does-not-exist",
      payload: { modelId: "composer-2-5" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(patch.statusCode).toBe(404);
  });

  it("thinking-delta from onDelta is persisted and visible in events", async () => {
    h = await buildHarness({
      sdkOverride: createStubSdkAdapter({
        onSend: ({ agent, idempotencyKey }) => ({
          runId: idempotencyKey ?? "think-run",
          agentId: agent.agentId,
          deltasOnce: [
            { type: "thinking-delta", text: "Let me " },
            { type: "thinking-delta", text: "reason about this." },
            { type: "thinking-completed", thinkingDurationMs: 1200 },
            {
              type: "turn-ended",
              usage: {
                inputTokens: 100,
                outputTokens: 50,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
            },
          ],
          events: [
            { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "RUNNING" },
            {
              type: "assistant",
              agent_id: agent.agentId,
              run_id: idempotencyKey,
              message: { role: "assistant", content: [{ type: "text", text: "done" }] },
            },
            { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "FINISHED" },
          ],
          finalResult: { status: "finished", result: "done", durationMs: 2000 },
        }),
      }),
    });
    const token = await h.csrfToken();

    const createRes = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "thinker",
        mode: "local",
        modelId: "composer-2-5",
        cwd: [h.allowedDir],
        mcpServerIds: [],
        subagentDefinitionIds: [],
      },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const agentId = (createRes.json() as { id: string }).id;

    const runRes = await h.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { agentId, prompt: "think for me" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    expect(runRes.statusCode).toBe(201);
    const { runId } = runRes.json() as { runId: string };

    for (let i = 0; i < 40; i++) {
      const poll = await h.app.inject({
        method: "GET",
        url: `/api/runs/${runId}`,
        headers: { origin: "http://127.0.0.1:5173" },
      });
      const status = (poll.json() as { status: string }).status;
      if (status === "FINISHED" || status === "ERROR" || status === "CANCELLED") break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const eventsRes = await h.app.inject({
      method: "GET",
      url: `/api/runs/${runId}/events`,
      headers: { origin: "http://127.0.0.1:5173" },
    });
    type ThinkingFrame = {
      type: string;
      event: {
        sdk_type: string;
        kind: string;
        payload: { text_delta: string; thinking_duration_ms?: number };
      };
    };
    const frames = (eventsRes.json() as { items: ThinkingFrame[] }).items;
    const thinkingFrames = frames.filter((f) => f.type === "sdk.thinking");

    expect(thinkingFrames.length).toBeGreaterThanOrEqual(2);
    expect(thinkingFrames[0]!.event.kind).toBe("thinking.delta");
    expect(thinkingFrames[0]!.event.payload.text_delta).toBe("Let me ");
    expect(thinkingFrames[1]!.event.kind).toBe("thinking.delta");
    expect(thinkingFrames[1]!.event.payload.text_delta).toBe("reason about this.");

    const completedFrames = thinkingFrames.filter(
      (f) => f.event.payload.thinking_duration_ms !== undefined,
    );
    expect(completedFrames.length).toBe(1);
    expect(completedFrames[0]!.event.payload.thinking_duration_ms).toBe(1200);
  });
});

// Reference imports so unused-import lint doesn't trip on the testing exports
// used indirectly via the stubbed adapter.
void StubRun;
void StubSDKAgent;
