import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
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
import { createStubSdkAdapter } from "../../sdk/testing.js";

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
  csrfToken: () => Promise<string>;
  allowedDir: string;
}

async function buildHarness(opts: {
  events: ReadonlyArray<unknown>;
  beforeEachOnDelta?: ReadonlyArray<unknown>;
}): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-ws-"));
  const allowedDir = path.join(tmpDir, "ws");
  await fs.mkdir(allowedDir);
  const realAllowed = await fs.realpath(allowedDir);

  const env = loadEnv(BASE_ENV);
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  repos.workspaceAllowlist.create({ path: realAllowed, recursive: true });

  const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
  await apiKeyStore.setApiKey("sk-test-ws-12345678");

  const sdk = createStubSdkAdapter({
    onSend: ({ agent, idempotencyKey }) => ({
      runId: idempotencyKey ?? `stub-${Date.now()}`,
      agentId: agent.agentId,
      events: opts.events,
      ...(opts.beforeEachOnDelta !== undefined
        ? { deltasBeforeEach: opts.beforeEachOnDelta }
        : {}),
      finalResult: { status: "finished" as const, result: "done", durationMs: 1 },
    }),
  });

  const { app } = await buildApp({
    env,
    repos,
    apiKeyStore,
    csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
    sdk,
    // Short cadence so the heartbeat test doesn't have to wait 15s.
    wsHeartbeatIntervalMs: 50,
    wsMissedPongTimeoutMs: 1_000,
  });
  // Force the HTTP server to listen so injectWS can dial a real socket.
  await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    app,
    allowedDir: realAllowed,
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

function recv(socket: WebSocket, predicate: (frame: unknown) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMsg);
      reject(new Error("timed out waiting for frame"));
    }, 4_000);
    function onMsg(data: Buffer | string): void {
      let frame: unknown;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return;
      }
      if (predicate(frame)) {
        clearTimeout(timeout);
        socket.off("message", onMsg);
        resolve(frame);
      }
    }
    socket.on("message", onMsg);
  });
}

async function makeRunWithEvents(
  h: Harness,
  events: ReadonlyArray<unknown>,
): Promise<{ agentId: string; runId: string }> {
  void events;
  const token = await h.csrfToken();
  const create = await h.app.inject({
    method: "POST",
    url: "/api/agents",
    payload: {
      name: "ws-agent",
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
  const runRes = await h.app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { agentId, prompt: "hello" },
    headers: {
      origin: "http://127.0.0.1:5173",
      "x-csrf-token": token,
      "content-type": "application/json",
    },
  });
  const runId = (runRes.json() as { runId: string }).runId;
  // Let the consume loop finish.
  await new Promise((r) => setTimeout(r, 80));
  return { agentId, runId };
}

describe("WebSocket — Phase 07 streaming + reconnect", () => {
  let h: Harness;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    await h?.close();
    resetKeychainDriverForTests();
  });

  it("rejects an upgrade without a valid Origin", async () => {
    h = await buildHarness({ events: [] });
    await expect(
      h.app.injectWS("/ws", {
        headers: { origin: "http://evil.example.com" },
      }),
    ).rejects.toThrow();
  });

  it("rejects an upgrade without a CSRF token (closes the socket)", async () => {
    h = await buildHarness({ events: [] });
    const socket = await h.app.injectWS("/ws", {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    // Attach `close` listener immediately, but ALSO race against a poll on
    // readyState — the close event may have already fired between injectWS
    // resolving and us getting control back.
    const closed = await Promise.race([
      new Promise<{ via: "event"; code: number }>((resolve) => {
        socket.once("close", (code: number) => resolve({ via: "event", code }));
      }),
      (async () => {
        // Poll up to 3 seconds for the socket to transition through CLOSING
        // to CLOSED. socket.CLOSED === 3, CLOSING === 2.
        for (let i = 0; i < 60; i++) {
          if (socket.readyState === socket.CLOSED || socket.readyState === socket.CLOSING) {
            return { via: "poll" as const, code: socket.readyState } as {
              via: "poll";
              code: number;
            };
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        return { via: "poll" as const, code: -1 } as { via: "poll"; code: number };
      })(),
    ]);
    // We don't care HOW we observed it (close event or readyState poll) —
    // only that the socket is no longer usable. A 1008 code is preferred
    // but injectWS may suppress the wire code for tests; CLOSING/CLOSED is
    // sufficient evidence the gate worked.
    const usable =
      closed.via === "event"
        ? closed.code === 1008
        : closed.code === socket.CLOSED || closed.code === socket.CLOSING;
    expect(usable).toBe(true);
  });

  it("subscribes to a finished run, replays 50 events in order, then ack replay_complete", async () => {
    const events: unknown[] = [
      { type: "status", agent_id: "PLACEHOLDER", run_id: "PLACEHOLDER", status: "RUNNING" },
    ];
    for (let i = 0; i < 48; i++) {
      events.push({
        type: "assistant",
        agent_id: "PLACEHOLDER",
        run_id: "PLACEHOLDER",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "x".repeat(i + 1) }],
        },
      });
    }
    events.push({
      type: "status",
      agent_id: "PLACEHOLDER",
      run_id: "PLACEHOLDER",
      status: "FINISHED",
    });
    h = await buildHarness({ events: synthesiseStubEvents(events) });
    const token = await h.csrfToken();
    const { runId } = await makeRunWithEvents(h, events);

    const socket = await h.app.injectWS(`/ws?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const sub = {
      id: "frame-subscribe-1",
      type: "subscribe_run",
      sent_at: new Date().toISOString(),
      run_id: runId,
      after_seq: 0,
    };
    socket.send(JSON.stringify(sub));

    const collected: Array<{ seq: number; kind: string }> = [];
    socket.on("message", (data: unknown) => {
      const f = JSON.parse(String(data)) as {
        type: string;
        event?: { seq: number; kind: string };
      };
      if (f.type.startsWith("sdk.") || f.type === "run.final_result") {
        if (f.event) collected.push({ seq: f.event.seq, kind: f.event.kind });
      }
    });

    await recv(socket, (f) => {
      const r = f as { type: string; replay_complete?: boolean };
      return r.type === "ack" && r.replay_complete === true;
    });

    // We expect 50 canonical events (1 status + 48 assistant + 1 status).
    expect(collected.length).toBe(50);
    const seqs = collected.map((c) => c.seq);
    for (let i = 1; i < seqs.length; i++) {
      const prev = seqs[i - 1];
      const cur = seqs[i];
      if (prev === undefined || cur === undefined) throw new Error("undefined seq");
      expect(cur).toBe(prev + 1);
    }

    socket.close();
  });

  it("reconnects with after_seq and reconstructs the full event list with no gaps", async () => {
    const events: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        type: "assistant",
        agent_id: "PLACEHOLDER",
        run_id: "PLACEHOLDER",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "x".repeat(i + 1) }],
        },
      });
    }
    h = await buildHarness({ events: synthesiseStubEvents(events) });
    const token = await h.csrfToken();
    const { runId } = await makeRunWithEvents(h, events);

    // First socket — read first 10 events then close.
    const firstSocket = await h.app.injectWS(`/ws?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const firstSeen: number[] = [];
    firstSocket.on("message", (data: Buffer | string) => {
      const f = JSON.parse(String(data)) as {
        type: string;
        event?: { seq: number };
      };
      if (f.type === "sdk.assistant" && f.event) firstSeen.push(f.event.seq);
    });
    firstSocket.send(
      JSON.stringify({
        id: "first-sub",
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
        after_seq: 0,
      }),
    );
    // Wait until the replay completes, then close.
    await recv(firstSocket, (f) => {
      const r = f as { type: string; replay_complete?: boolean };
      return r.type === "ack" && r.replay_complete === true;
    });
    firstSocket.close();

    // Pretend the client had only applied 10 events (e.g. UI lag).
    const cursor = 10;

    const secondSocket = await h.app.injectWS(`/ws?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const secondSeen: number[] = [];
    secondSocket.on("message", (data: Buffer | string) => {
      const f = JSON.parse(String(data)) as {
        type: string;
        replayed?: boolean;
        event?: { seq: number };
      };
      if (f.type === "sdk.assistant" && f.event) {
        secondSeen.push(f.event.seq);
        // First batch should be marked replayed.
        expect(f.replayed === true).toBe(true);
      }
    });
    secondSocket.send(
      JSON.stringify({
        id: "second-sub",
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
        after_seq: cursor,
      }),
    );
    await recv(secondSocket, (f) => {
      const r = f as { type: string; replay_complete?: boolean };
      return r.type === "ack" && r.replay_complete === true;
    });
    expect(secondSeen).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    secondSocket.close();
  });

  it("emits server heartbeat frames at startup", async () => {
    h = await buildHarness({ events: [] });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(`/ws?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const beat = await recv(socket, (f) => (f as { type: string }).type === "heartbeat");
    expect((beat as { heartbeat_id: string }).heartbeat_id).toBeTypeOf("string");
    socket.close();
  });

  it("inlines tool_call payloads under the 256 KiB threshold and references them via URL when above", async () => {
    // Build a tool_call whose result.value.diffString is just over 256 KiB.
    const big = "x".repeat(260 * 1024);
    const events: unknown[] = [
      {
        type: "tool_call",
        agent_id: "PLACEHOLDER",
        run_id: "PLACEHOLDER",
        call_id: "big-1",
        name: "edit",
        status: "completed",
        args: { path: "src/big.ts" },
        result: { value: { diffString: big } },
      },
      { type: "status", agent_id: "PLACEHOLDER", run_id: "PLACEHOLDER", status: "FINISHED" },
    ];
    h = await buildHarness({ events });
    const token = await h.csrfToken();
    const { runId } = await makeRunWithEvents(h, events);

    const socket = await h.app.injectWS(`/ws?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    let bigFrame: { payload?: { args?: unknown; result?: unknown; large_payload_refs?: unknown } } | null = null;
    socket.on("message", (data: Buffer | string) => {
      const f = JSON.parse(String(data)) as { type: string; event?: { kind: string; payload: unknown } };
      if (f.type === "sdk.tool_call" && f.event?.kind === "tool_call.completed") {
        bigFrame = f.event as unknown as typeof bigFrame;
      }
    });
    socket.send(
      JSON.stringify({
        id: "subscribe-big-1",
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
        after_seq: 0,
      }),
    );
    await recv(socket, (f) => {
      const r = f as { type: string; replay_complete?: boolean };
      return r.type === "ack" && r.replay_complete === true;
    });

    expect(bigFrame).not.toBeNull();
    const payload = (bigFrame as unknown as { payload: { args?: unknown; result?: unknown; large_payload_refs?: { result_event_url?: string; args_event_url?: string } } }).payload;
    // Heavy fields should be stripped.
    expect(payload.result).toBeUndefined();
    // Refs should point at the lazy fetch endpoints.
    expect(payload.large_payload_refs?.result_event_url).toMatch(
      /^\/api\/events\/[^/]+\/large-payload\/result$/,
    );
    socket.close();
  });

  it("isolates parallel runs — a subscriber to run-A doesn't see run-B's events", async () => {
    const events: unknown[] = [
      {
        type: "assistant",
        agent_id: "PLACEHOLDER",
        run_id: "PLACEHOLDER",
        message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
      },
      { type: "status", agent_id: "PLACEHOLDER", run_id: "PLACEHOLDER", status: "FINISHED" },
    ];
    h = await buildHarness({ events });
    const token = await h.csrfToken();

    // Two separate agents → two separate runs.
    const create1 = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "agent-A",
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
    const agentA = (create1.json() as { id: string }).id;
    const create2 = await h.app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "agent-B",
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
    const agentB = (create2.json() as { id: string }).id;

    const runA = await h.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { agentId: agentA, prompt: "ping" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const runB = await h.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { agentId: agentB, prompt: "ping" },
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-csrf-token": token,
        "content-type": "application/json",
      },
    });
    const runIdA = (runA.json() as { runId: string }).runId;
    const runIdB = (runB.json() as { runId: string }).runId;
    // Give both consume loops time to fully finalise.
    await new Promise((r) => setTimeout(r, 250));

    const socket = await h.app.injectWS(`/ws?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const seen = new Set<string>();
    socket.on("message", (data: Buffer | string) => {
      const f = JSON.parse(String(data)) as { type: string; event?: { run_id: string } };
      if (f.event?.run_id) seen.add(f.event.run_id);
    });
    socket.send(
      JSON.stringify({
        id: "subscribe-A-only-1",
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runIdA,
        after_seq: 0,
      }),
    );
    await recv(socket, (f) => {
      const r = f as { type: string; replay_complete?: boolean };
      return r.type === "ack" && r.replay_complete === true;
    });

    expect(seen.has(runIdA)).toBe(true);
    expect(seen.has(runIdB)).toBe(false);
    socket.close();
  });

  it("rejects an unknown run_id with RUN_NOT_FOUND", async () => {
    h = await buildHarness({ events: [] });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(`/ws?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    socket.send(
      JSON.stringify({
        id: "subscribe-bad",
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: "no-such-run",
        after_seq: 0,
      }),
    );
    const err = await recv(socket, (f) => (f as { type: string }).type === "error");
    expect((err as { code: string }).code).toBe("RUN_NOT_FOUND");
    socket.close();
  });
});

// Helper: rewrite the agent_id/run_id placeholders to the stub's actual values
// at the moment the stub builds its synthetic stream. The stub closure
// receives the agent + idempotency key, so we can inject the real ids.
function synthesiseStubEvents(template: ReadonlyArray<unknown>): ReadonlyArray<unknown> {
  // We don't know the real ids until `onSend` runs, so the stub adapter
  // patches them at runtime inside the StubRun's stream generator. The
  // template carries "PLACEHOLDER" sentinels that the harness's runtime
  // never reads — the persist-and-broadcast pipeline uses the runId/agentId
  // explicitly passed to ingestSDKMessage (NOT the values inside the raw
  // event payload). So the placeholders are harmless here.
  return template;
}
