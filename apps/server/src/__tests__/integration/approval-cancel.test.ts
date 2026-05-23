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

/**
 * Default timeout is 4s — deliberately below vitest's 5s `it()`
 * default. This guarantees the helper's diagnostic stderr print fires
 * BEFORE vitest kills the test, so the failure reason is visible.
 * Bumping this to >= 5000 will re-introduce the silent-timeout failure
 * mode that ate ~30 minutes of P14-W6 debugging.
 */
const WAIT_FOR_FRAME_DEFAULT_TIMEOUT_MS = 4_000;

function waitForFrame<T extends { type: string }>(
  ws: WebSocket,
  matcher: (frame: T) => boolean,
  timeoutMs = WAIT_FOR_FRAME_DEFAULT_TIMEOUT_MS,
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
        return;
      }
      // Fast-fail on server-side validation errors that signal the
      // wait will never succeed. A matcher that DOES expect an error
      // (e.g. APPROVAL_NOT_PENDING tests) matches first and resolves
      // above; only unrelated errors land here.
      const errFrame = frame as unknown as {
        type: string;
        code?: string;
        message?: string;
      };
      if (errFrame.type === "error" && errFrame.code === "VALIDATION_ERROR") {
        clearTimeout(timer);
        ws.removeListener("message", listener);
        reject(
          new Error(
            `server replied VALIDATION_ERROR while waiting for a different frame: ${errFrame.message ?? "no message"}. Most common cause: frame id below min(8). Saw: ${JSON.stringify(seen, null, 2)}`,
          ),
        );
      }
    };
    ws.on("message", listener);
  });
}

/**
 * Build a client frame id that satisfies frameIdSchema.min(8).max(128).
 * Centralized so individual test authors can't accidentally craft a
 * <8-char id and watch their test hang waiting for a server reply that
 * (correctly) refuses to honor a malformed frame — the silent-failure
 * trap P14-W6 fell into.
 */
function makeFrameId(prefix: string): string {
  const padded = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  // Belt-and-braces: guarantee min(8) even if prefix is empty.
  return padded.padEnd(8, "x");
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

  // P14-W6: regression test locking in the contract from ws-plugin.ts:764
  // ("frame.reason is user-controlled text — treat any new consumer as
  // untrusted input"). The persistence path must carry `reason` as plain
  // string data, not as a pre-decoded HTML / JSX node. If a future
  // refactor inadvertently routes payload.reason through a markdown-or-
  // HTML inspector without escaping, this test fails because the
  // adversarial sentinel survives untouched through to the canonical
  // event row.
  it("P14-W6: frame.reason is persisted as plain string data (no HTML decoding)", async () => {
    const MALICIOUS_REASON = "<script>alert('xss')</script>";
    const captured: { reason: unknown } = { reason: null };
    h = await buildHarness({
      approvalResponder: {
        resolve: async (input) => {
          captured.reason = input.reason;
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
        id: makeFrameId("sub-w6"),
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
        id: makeFrameId("approve-w6"),
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: "req-1",
        decision: "deny",
        reason: MALICIOUS_REASON,
      }),
    );

    const resolved = await waitForFrame<{
      type: string;
      event?: { payload?: { reason?: unknown } };
    }>(ws, (frame) => frame.type === "approval.resolved");

    // 1. The responder received the reason verbatim (proves the inbound
    //    parse + frame.reason forwarding doesn't mutate the string).
    expect(captured.reason).toBe(MALICIOUS_REASON);
    // 2. The outbound canonical event payload carries the reason as a
    //    plain JS string in the WS payload, NOT an object, parsed HTML
    //    node, or anything that signals "rendered". A consumer reading
    //    this is on the hook to escape.
    expect(typeof resolved.event?.payload?.reason).toBe("string");
    // 3. The byte-for-byte sentinel survives the round trip unmolested
    //    — no encoder ate the `<script>` tag, no escape pass mutated it.
    expect(resolved.event?.payload?.reason).toBe(MALICIOUS_REASON);
    // 4. The frame's JSON serialization carries the sentinel as-is
    //    (proves no nested HTML encoding has snuck in at the WS layer).
    expect(JSON.stringify(resolved)).toContain(MALICIOUS_REASON);
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

  it("RV2-C2: a second approval_response for the same request_id while the first is in flight is rejected as already in flight", async () => {
    // Slow responder so the first frame is parked in `await
    // approvalResponder.resolve(...)` while the second arrives.
    let releaseFirst!: () => void;
    const firstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let resolveCallCount = 0;
    h = await buildHarness({
      approvalResponder: {
        resolve: async () => {
          resolveCallCount += 1;
          if (resolveCallCount === 1) await firstPromise;
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

    // Fire two approval frames back-to-back. Different IDs so dedupe
    // doesn't catch them.
    ws.send(
      JSON.stringify({
        id: "approval-first-frame-id-aaaa",
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: "req-1",
        decision: "approve",
      }),
    );
    ws.send(
      JSON.stringify({
        id: "approval-second-frame-id-bbb",
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: "req-1",
        decision: "deny",
      }),
    );

    // Second frame should bounce immediately as APPROVAL_NOT_PENDING
    // (already in flight). The first is still parked in firstPromise.
    const err = await waitForFrame<{ type: string; code?: string; ack_for?: string }>(
      ws,
      (frame) =>
        frame.type === "error" &&
        frame.code === "APPROVAL_NOT_PENDING" &&
        frame.ack_for === "approval-second-frame-id-bbb",
    );
    expect(err.code).toBe("APPROVAL_NOT_PENDING");

    // Now release the first so the responder finishes and the
    // approval.resolved frame goes out.
    releaseFirst();
    const resolved = await waitForFrame<{ type: string }>(
      ws,
      (frame) => frame.type === "approval.resolved",
    );
    expect(resolved.type).toBe("approval.resolved");
    // Only the first responder call should have run; the second never
    // reached the responder.
    expect(resolveCallCount).toBe(1);
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
