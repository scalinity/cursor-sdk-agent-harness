import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { buildApp, type BuiltApp } from "../../app.js";
import { loadEnv } from "../../config/env.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { CsrfSecretStore, CursorApiKeyStore } from "../../keychain/index.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../../keychain/testing.js";
import { createStubSdkAdapter } from "../../sdk/testing.js";
import type { ApprovalResponder } from "../../sdk/approval-responder.js";
import { UnimplementedApprovalError } from "../../sdk/approval-responder.js";

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
  built: BuiltApp;
  port: number;
  close: () => Promise<void>;
  allowedDir: string;
  csrfToken: () => Promise<string>;
  openSocket: (csrf: string) => Promise<WebSocket>;
}

async function buildHarness(opts: {
  approvalResponder?: ApprovalResponder;
  cancellable?: boolean;
} = {}): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-app-"));
  const allowedDir = path.join(tmpDir, "ws");
  await fs.mkdir(allowedDir);
  const realAllowed = await fs.realpath(allowedDir);

  const env = loadEnv(BASE_ENV);
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  repos.workspaceAllowlist.create({ path: realAllowed, recursive: true });

  const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
  await apiKeyStore.setApiKey("sk-test-12345678");

  // Stub adapter that emits a `request.created` event followed by a
  // long-paused tail so the run stays RUNNING while approvals/cancels
  // race against it.
  const cancellable = opts.cancellable !== false;
  const sdk = createStubSdkAdapter({
    onSend: ({ agent, idempotencyKey }) => ({
      runId: idempotencyKey ?? "stub-run",
      agentId: agent.agentId,
      supportsCancel: cancellable,
      events: [
        { type: "status", agent_id: agent.agentId, run_id: idempotencyKey, status: "RUNNING" },
        {
          type: "tool_call",
          agent_id: agent.agentId,
          run_id: idempotencyKey,
          call_id: "call-1",
          name: "shell",
          status: "running",
          args: { command: "do" },
        },
        {
          type: "request",
          agent_id: agent.agentId,
          run_id: idempotencyKey,
          request_id: "req-1",
        },
        // Then the stub stream returns; the harness sees stream end and
        // moves to wait(). We rely on `finalResult.status = finished`
        // by default in the helper above to avoid lingering RUNNING.
      ],
      finalResult: { status: "finished", result: "ok", durationMs: 5 },
    }),
  });

  const built = await buildApp({
    env,
    repos,
    apiKeyStore,
    csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
    sdk,
    wsHeartbeatIntervalMs: 5_000,
    wsMissedPongTimeoutMs: 10_000,
    ...(opts.approvalResponder ? { approvalResponder: opts.approvalResponder } : {}),
  });
  await built.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = built.app.server.address() as AddressInfo;
  const port = addr.port;

  return {
    app: built.app,
    built,
    port,
    allowedDir: realAllowed,
    close: async () => {
      await built.app.close();
      dbClient.raw.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    csrfToken: async () => {
      const res = await built.app.inject({
        method: "GET",
        url: "/api/security/csrf-token",
        headers: { origin: "http://127.0.0.1:5173" },
      });
      return (res.json() as { token: string }).token;
    },
    openSocket: async (csrf) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?csrf=${encodeURIComponent(csrf)}`, {
        headers: { Origin: "http://127.0.0.1:5173" },
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return ws;
    },
  };
}

async function createAgent(h: Harness, csrf: string): Promise<string> {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/agents",
    payload: {
      name: "approval test",
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
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function startRun(h: Harness, csrf: string, agentId: string): Promise<string> {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { agentId, prompt: "go" },
    headers: {
      origin: "http://127.0.0.1:5173",
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { runId: string };
  return body.runId;
}

function waitForFrame<T extends { type: string }>(
  ws: WebSocket,
  matcher: (frame: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const seen: unknown[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener("message", listener);
      process.stderr.write(
        `waitForFrame timeout. saw: ${JSON.stringify(seen, null, 2)}\n`,
      );
      reject(new Error(`timed out waiting for frame`));
    }, timeoutMs);
    const listener = (raw: WebSocket.RawData) => {
      const frame = JSON.parse(raw.toString("utf8")) as T;
      seen.push(frame);
      if (matcher(frame)) {
        clearTimeout(timer);
        ws.removeListener("message", listener);
        resolve(frame);
      }
    };
    ws.on("message", listener);
  });
}

describe("approval and cancellation integration", () => {
  let h: Harness;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    await h?.close();
    resetKeychainDriverForTests();
  });

  it("emits approval.failed with APPROVAL_UNIMPLEMENTED when the responder throws (default OQ-10 branch)", async () => {
    h = await buildHarness({
      approvalResponder: {
        resolve: async () => {
          throw new UnimplementedApprovalError();
        },
      },
    });
    const csrf = await h.csrfToken();
    const agentId = await createAgent(h, csrf);
    const runId = await startRun(h, csrf, agentId);

    // Give the stubbed run a moment to write the request.created event.
    await new Promise((r) => setTimeout(r, 100));

    const ws = await h.openSocket(csrf);
    ws.send(
      JSON.stringify({
        id: "frame-sub-1",
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
        after_seq: 0,
        replay: { enabled: true, speed: "instant" },
      }),
    );
    // Drain replay until we see the request event.
    await waitForFrame<{ type: string; event?: { kind?: string } }>(
      ws,
      (frame) => frame.type === "sdk.request" && frame.event?.kind === "request.created",
    );

    ws.send(
      JSON.stringify({
        id: "frame-approve-1",
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: "req-1",
        decision: "approve",
      }),
    );

    const failed = await waitForFrame<{
      type: string;
      event?: { kind?: string; payload?: { code?: string; message?: string } };
    }>(ws, (frame) => frame.type === "approval.failed");
    expect(failed.event?.payload?.code).toBe("APPROVAL_UNIMPLEMENTED");
    ws.close();
  });

  it("emits approval.resolved when the responder accepts the decision", async () => {
    const captured: { value: { runId: string; requestId: string; decision: string } | null } =
      { value: null };
    h = await buildHarness({
      approvalResponder: {
        resolve: async (input) => {
          captured.value = {
            runId: input.runId,
            requestId: input.requestId,
            decision: input.decision,
          };
        },
      },
    });
    const csrf = await h.csrfToken();
    const agentId = await createAgent(h, csrf);
    const runId = await startRun(h, csrf, agentId);
    await new Promise((r) => setTimeout(r, 100));

    const ws = await h.openSocket(csrf);
    ws.send(
      JSON.stringify({
        id: "sub-1234",
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
        after_seq: 0,
        replay: { enabled: true, speed: "instant" },
      }),
    );
    await waitForFrame<{ type: string; event?: { kind?: string } }>(
      ws,
      (frame) => frame.type === "sdk.request" && frame.event?.kind === "request.created",
    );

    ws.send(
      JSON.stringify({
        id: "approve-frame-1",
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: "req-1",
        decision: "deny",
        reason: "nope",
      }),
    );

    const resolved = await waitForFrame<{
      type: string;
      event?: { payload?: { decision?: string; reason?: string } };
    }>(ws, (frame) => frame.type === "approval.resolved");
    expect(resolved.event?.payload?.decision).toBe("deny");
    expect(captured.value?.requestId).toBe("req-1");
    ws.close();
  });

  it("replies APPROVAL_NOT_PENDING when no matching request exists", async () => {
    h = await buildHarness();
    const csrf = await h.csrfToken();
    const agentId = await createAgent(h, csrf);
    const runId = await startRun(h, csrf, agentId);
    await new Promise((r) => setTimeout(r, 100));

    const ws = await h.openSocket(csrf);
    ws.send(
      JSON.stringify({
        id: "approve-frame-1",
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: "no-such-request",
        decision: "approve",
      }),
    );
    const err = await waitForFrame<{ type: string; code?: string }>(
      ws,
      (frame) => frame.type === "error" && frame.code === "APPROVAL_NOT_PENDING",
    );
    expect(err.code).toBe("APPROVAL_NOT_PENDING");
    ws.close();
  });

  it("startup-recovery finalizes RUNNING runs left by a prior process", async () => {
    // Seed a RUNNING row BEFORE buildApp runs recovery in onReady.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-recovery-"));
    const allowedDir = path.join(tmpDir, "ws");
    await fs.mkdir(allowedDir);
    const realAllowed = await fs.realpath(allowedDir);
    const env = loadEnv(BASE_ENV);
    const dbClient = openTestDb();
    const repos = createRepositories(dbClient.raw);
    repos.workspaceAllowlist.create({ path: realAllowed, recursive: true });
    const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
    await apiKeyStore.setApiKey("sk-test-12345678");
    const agent = repos.agents.create({
      name: "stale",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      cwd: [realAllowed],
      sandboxEnabled: true,
      settingSources: ["project"],
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    const stale = repos.runs.create({
      agentId: agent.id,
      status: "RUNNING",
      promptPreview: "p",
      modelId: "composer-2-5-fast",
      mode: "local",
    });

    const built = await buildApp({
      env,
      repos,
      apiKeyStore,
      csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
      sdk: createStubSdkAdapter(),
    });
    // Trigger onReady hooks.
    await built.app.ready();
    const recovered = repos.runs.getById(stale.id);
    expect(recovered?.status).toBe("ERROR");
    expect(recovered?.interruptedReason).toBe("server_restart");
    const events = repos.events.getAllByRunId(stale.id);
    expect(events.some((e) => e.kind === "run.interrupted")).toBe(true);
    await built.app.close();
    dbClient.raw.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
