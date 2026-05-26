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
import { TerminalSession, type PtyProcess, type SpawnPty } from "../../terminal/index.js";

const ORIGIN = "http://127.0.0.1:5173";
const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: ORIGIN,
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-test",
  ALLOW_REMOTE_BIND: "false",
};

const NOOP_LOGGER = { info() {}, warn() {}, error() {} };

interface Harness {
  app: FastifyInstance;
  session: TerminalSession;
  close: () => Promise<void>;
  csrfToken: () => Promise<string>;
  cwd: string;
}

async function buildTerminalHarness(opts: {
  spawnPty?: SpawnPty;
  resolveCwd?: () => string | Promise<string>;
  shell?: string;
  shellArgs?: string[];
}): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-term-"));
  const realCwd = await fs.realpath(tmpDir);

  const env = loadEnv(BASE_ENV);
  const dbClient = openTestDb();
  const repos = createRepositories(dbClient.raw);
  repos.workspaceAllowlist.create({ path: realCwd, recursive: true });

  const apiKeyStore = new CursorApiKeyStore({ service: env.KEYCHAIN_SERVICE });
  await apiKeyStore.setApiKey("sk-test-term-12345678");

  const session = new TerminalSession({
    resolveCwd: opts.resolveCwd ?? (() => realCwd),
    logger: NOOP_LOGGER,
    ...(opts.spawnPty ? { spawnPty: opts.spawnPty } : {}),
    ...(opts.shell ? { shell: opts.shell } : {}),
    ...(opts.shellArgs ? { shellArgs: opts.shellArgs } : {}),
  });

  const sdk = createStubSdkAdapter({
    onSend: ({ agent, idempotencyKey }) => ({
      runId: idempotencyKey ?? `stub-${Date.now()}`,
      agentId: agent.agentId,
      events: [],
      finalResult: { status: "finished" as const, result: "done", durationMs: 1 },
    }),
  });

  const { app } = await buildApp({
    env,
    repos,
    apiKeyStore,
    csrfSecretStore: new CsrfSecretStore({ service: env.KEYCHAIN_SERVICE }),
    sdk,
    terminalSession: session,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    app,
    session,
    cwd: realCwd,
    close: async () => {
      await app.close();
      dbClient.raw.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    csrfToken: async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/security/csrf-token",
        headers: { origin: ORIGIN },
      });
      return (res.json() as { token: string }).token;
    },
  };
}

/** A fake PTY whose output/exit the test drives, capturing writes + resizes. */
function makeFakePty(): {
  pty: PtyProcess;
  emitData: (s: string) => void;
  emitExit: (code: number, signal?: number) => void;
  writes: string[];
  resizes: Array<[number, number]>;
  killed: () => boolean;
} {
  let dataCb: ((d: string) => void) | undefined;
  let exitCb: ((e: { exitCode: number; signal?: number | undefined }) => void) | undefined;
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];
  let wasKilled = false;
  const pty: PtyProcess = {
    onData: (cb) => {
      dataCb = cb;
      return { dispose() {} };
    },
    onExit: (cb) => {
      exitCb = cb;
      return { dispose() {} };
    },
    write: (d) => writes.push(d),
    resize: (c, r) => resizes.push([c, r]),
    kill: () => {
      wasKilled = true;
    },
  };
  return {
    pty,
    emitData: (s) => dataCb?.(s),
    emitExit: (code, signal) => exitCb?.({ exitCode: code, signal }),
    writes,
    resizes,
    killed: () => wasKilled,
  };
}

type Frame = Record<string, unknown>;
type FramePredicate = (frame: Frame) => boolean;

/**
 * Buffers every frame from socket creation so sequential `waitFor`s never
 * race the back-to-back frames the server emits (e.g. ready → buffered
 * screen). Attach immediately after `injectWS`.
 */
interface Collector {
  waitFor(predicate: FramePredicate, timeoutMs?: number): Promise<Frame>;
}

function collect(socket: WebSocket): Collector {
  const frames: Frame[] = [];
  const waiters: Array<{ predicate: FramePredicate; resolve: (f: Frame) => void }> = [];
  socket.on("message", (data: Buffer | string) => {
    let frame: Frame;
    try {
      frame = JSON.parse(String(data)) as Frame;
    } catch {
      return;
    }
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (waiter && waiter.predicate(frame)) {
        waiter.resolve(frame);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    waitFor(predicate, timeoutMs = 4_000) {
      const existing = frames.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<Frame>((resolve, reject) => {
        const entry = { predicate, resolve };
        waiters.push(entry);
        setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            reject(new Error("timed out waiting for terminal frame"));
          }
        }, timeoutMs);
      });
    },
  };
}

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForValue<T>(read: () => T | undefined, timeoutMs = 1_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await tick(10);
  }
  throw new Error("timed out waiting for test value");
}

describe("Embedded terminal — /ws/terminal", () => {
  let h: Harness;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
  });

  afterEach(async () => {
    await h?.close();
    resetKeychainDriverForTests();
  });

  it("rejects an upgrade with a disallowed Origin", async () => {
    const fake = makeFakePty();
    h = await buildTerminalHarness({ spawnPty: () => fake.pty });
    await expect(
      h.app.injectWS("/ws/terminal", { headers: { origin: "http://evil.example.com" } }),
    ).rejects.toThrow();
  });

  it("rejects an upgrade without a CSRF token (closes the socket)", async () => {
    const fake = makeFakePty();
    h = await buildTerminalHarness({ spawnPty: () => fake.pty });
    const socket = await h.app.injectWS("/ws/terminal", { headers: { origin: ORIGIN } });
    const closed = await Promise.race([
      new Promise<number>((resolve) => socket.once("close", (code: number) => resolve(code))),
      (async () => {
        for (let i = 0; i < 60; i++) {
          if (socket.readyState === socket.CLOSED || socket.readyState === socket.CLOSING) {
            return socket.readyState;
          }
          await tick(50);
        }
        return -1;
      })(),
    ]);
    expect(closed).not.toBe(-1);
  });

  it("sends ready with the resolved cwd, then streams PTY output and exit", async () => {
    const fake = makeFakePty();
    h = await buildTerminalHarness({ spawnPty: () => fake.pty });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const frames = collect(socket);

    const ready = await frames.waitFor((f) => f.type === "ready");
    expect(ready.cwd).toBe(h.cwd);
    expect(ready.cols).toBe(80);
    expect(ready.rows).toBe(24);

    fake.emitData("hello-from-pty\r\n");
    const data = await frames.waitFor((f) => f.type === "data");
    expect(data.data).toContain("hello-from-pty");

    fake.emitExit(0);
    const exit = await frames.waitFor((f) => f.type === "exit");
    expect(exit.code).toBe(0);
  });

  it("uses the requested initial viewport before spawning the PTY", async () => {
    const fake = makeFakePty();
    let spawnedSize: { cols: number; rows: number } | undefined;
    const spawnPty: SpawnPty = (opts) => {
      spawnedSize = { cols: opts.cols, rows: opts.rows };
      return fake.pty;
    };
    h = await buildTerminalHarness({ spawnPty });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(
      `/ws/terminal?csrf=${encodeURIComponent(token)}&cols=132&rows=37`,
      { headers: { origin: ORIGIN } },
    );
    const frames = collect(socket);

    const ready = await frames.waitFor((f) => f.type === "ready");
    expect(ready.cols).toBe(132);
    expect(ready.rows).toBe(37);
    expect(spawnedSize).toEqual({ cols: 132, rows: 37 });
  });

  it("accepts the shared terminal viewport lower bound", async () => {
    const fake = makeFakePty();
    let spawnedSize: { cols: number; rows: number } | undefined;
    h = await buildTerminalHarness({
      spawnPty: (opts) => {
        spawnedSize = { cols: opts.cols, rows: opts.rows };
        return fake.pty;
      },
    });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(
      `/ws/terminal?csrf=${encodeURIComponent(token)}&cols=1&rows=1`,
      { headers: { origin: ORIGIN } },
    );
    const frames = collect(socket);

    const ready = await frames.waitFor((f) => f.type === "ready");
    expect(ready.cols).toBe(1);
    expect(ready.rows).toBe(1);
    expect(spawnedSize).toEqual({ cols: 1, rows: 1 });
  });

  it("queues client input sent before terminal attach completes", async () => {
    const fake = makeFakePty();
    let releaseCwd: ((cwd: string) => void) | undefined;
    let resolveCalls = 0;
    h = await buildTerminalHarness({
      resolveCwd: () => {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          return new Promise<string>((resolve) => { releaseCwd = resolve; });
        }
        return h.cwd;
      },
      spawnPty: () => fake.pty,
    });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const frames = collect(socket);
    socket.send(JSON.stringify({ type: "input", data: "typed-too-early\n" }));
    const release = await waitForValue(() => releaseCwd);
    release(h.cwd);
    await frames.waitFor((f) => f.type === "ready");
    await tick();

    expect(fake.writes).toContain("typed-too-early\n");
  });

  it("kills a PTY returned after the session is disposed during spawn", async () => {
    const fake = makeFakePty();
    const sessionRef: { current?: TerminalSession } = {};
    const session = new TerminalSession({
      resolveCwd: () => "/workspace/a",
      logger: NOOP_LOGGER,
      spawnPty: () => {
        sessionRef.current?.dispose();
        return fake.pty;
      },
    });
    sessionRef.current = session;
    const received: Array<Record<string, unknown>> = [];
    await session.attach({ send: (f: Record<string, unknown>) => received.push(f) } as never);

    expect(fake.killed()).toBe(true);
    expect(received.some((f) => f.type === "error")).toBe(true);
  });

  it("respawns if the workspace changes while the first shell is starting", async () => {
    let cwd = "/workspace/a";
    let firstCwdResolve: ((cwd: string) => void) | undefined;
    let resolveCalls = 0;
    const spawns: Array<{ cwd: string; fake: ReturnType<typeof makeFakePty> }> = [];
    const session = new TerminalSession({
      resolveCwd: () => {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          return new Promise<string>((resolve) => { firstCwdResolve = resolve; });
        }
        return cwd;
      },
      logger: NOOP_LOGGER,
      spawnPty: (o) => {
        const fake = makeFakePty();
        spawns.push({ cwd: o.cwd, fake });
        return fake.pty;
      },
    });

    const received: Array<Record<string, unknown>> = [];
    const attach = session.attach({ send: (f: Record<string, unknown>) => received.push(f) } as never);
    const release = await waitForValue(() => firstCwdResolve);
    cwd = "/workspace/b";
    release("/workspace/a");
    await attach;

    expect(spawns.map((s) => s.cwd)).toEqual(["/workspace/a", "/workspace/b"]);
    expect(spawns[0]?.fake.killed()).toBe(true);
    expect(received.find((f) => f.type === "ready")?.cwd).toBe("/workspace/b");
    session.dispose();
  });

  it("routes client input to the PTY and applies resize", async () => {
    const fake = makeFakePty();
    h = await buildTerminalHarness({ spawnPty: () => fake.pty });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const frames = collect(socket);
    await frames.waitFor((f) => f.type === "ready");

    socket.send(JSON.stringify({ type: "input", data: "echo hi\n" }));
    socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await tick();

    expect(fake.writes).toContain("echo hi\n");
    expect(fake.resizes).toContainEqual([120, 40]);
  });

  it("replays the ring buffer to a re-attaching client", async () => {
    const fake = makeFakePty();
    h = await buildTerminalHarness({ spawnPty: () => fake.pty });
    const token = await h.csrfToken();

    const first = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const firstFrames = collect(first);
    await firstFrames.waitFor((f) => f.type === "ready");
    fake.emitData("PROMPT$ pwd\r\n/tmp\r\n");
    await firstFrames.waitFor((f) => f.type === "data");

    // A second client (reload / tab switch) gets ready + the buffered screen.
    const second = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const secondFrames = collect(second);
    await secondFrames.waitFor((f) => f.type === "ready");
    const replay = await secondFrames.waitFor((f) => f.type === "data");
    expect(replay.data).toContain("PROMPT$ pwd");
  });

  it("does not leak CURSOR_API_KEY into the spawned environment", async () => {
    let capturedEnv: Record<string, string> = {};
    const spawnPty: SpawnPty = (o) => {
      capturedEnv = o.env;
      return makeFakePty().pty;
    };
    process.env.CURSOR_API_KEY = "sk-should-not-leak";
    try {
      h = await buildTerminalHarness({ spawnPty });
      const token = await h.csrfToken();
      const socket = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
        headers: { origin: ORIGIN },
      });
      const frames = collect(socket);
      await frames.waitFor((f) => f.type === "ready");
      expect(capturedEnv.CURSOR_API_KEY).toBeUndefined();
      expect(capturedEnv.TERM).toBe("xterm-256color");
    } finally {
      delete process.env.CURSOR_API_KEY;
    }
  });

  it("responds with an error frame for an invalid client frame", async () => {
    const fake = makeFakePty();
    h = await buildTerminalHarness({ spawnPty: () => fake.pty });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const frames = collect(socket);
    await frames.waitFor((f) => f.type === "ready");

    socket.send(JSON.stringify({ type: "bogus" }));
    const err = await frames.waitFor((f) => f.type === "error");
    expect(err.message).toContain("schema validation");
  });

  it("sends an error frame when the PTY fails to spawn", async () => {
    // Test the session directly (not via WS) to avoid the listener-attach
    // race inherent in testing fast error paths through injectWS.
    const spawnPty = () => {
      throw new Error("spawn-helper not found");
    };
    const session = new TerminalSession({
      resolveCwd: () => "/tmp",
      logger: NOOP_LOGGER,
      spawnPty,
    });
    const received: Array<Record<string, unknown>> = [];
    const client = { send: (f: Record<string, unknown>) => received.push(f) };
    await session.attach(client as never);
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("error");
    expect(received[0]?.message).toContain("spawn-helper not found");
    session.dispose();
  });

  it("broadcasts data to multiple concurrent clients", async () => {
    const fake = makeFakePty();
    h = await buildTerminalHarness({ spawnPty: () => fake.pty });
    const token = await h.csrfToken();

    const s1 = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const f1 = collect(s1);
    await f1.waitFor((f) => f.type === "ready");

    const s2 = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const f2 = collect(s2);
    await f2.waitFor((f) => f.type === "ready");

    fake.emitData("shared-output\r\n");
    const d1 = await f1.waitFor(
      (f) => f.type === "data" && String(f.data).includes("shared-output"),
    );
    const d2 = await f2.waitFor(
      (f) => f.type === "data" && String(f.data).includes("shared-output"),
    );
    expect(d1.data).toContain("shared-output");
    expect(d2.data).toContain("shared-output");
  });

  it("respawns the shell in the new directory when the active workspace changes", async () => {
    // Direct session (not via WS) to avoid the injectWS listener-attach race.
    let cwd = "/workspace/a";
    const spawns: Array<{ cwd: string; fake: ReturnType<typeof makeFakePty> }> = [];
    const spawnPty: SpawnPty = (o) => {
      const fake = makeFakePty();
      spawns.push({ cwd: o.cwd, fake });
      return fake.pty;
    };
    const session = new TerminalSession({
      resolveCwd: () => cwd,
      logger: NOOP_LOGGER,
      spawnPty,
    });

    // First attach → spawns in workspace A.
    const r1: Array<Record<string, unknown>> = [];
    await session.attach({ send: (f: Record<string, unknown>) => r1.push(f) } as never);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.cwd).toBe("/workspace/a");
    expect(r1.find((f) => f.type === "ready")?.cwd).toBe("/workspace/a");

    // Output from workspace A lands in the ring buffer.
    spawns[0]?.fake.emitData("output-from-a\r\n");

    // Switch the active workspace, then reattach (mirrors the client's re-dial).
    cwd = "/workspace/b";
    const r2: Array<Record<string, unknown>> = [];
    await session.attach({ send: (f: Record<string, unknown>) => r2.push(f) } as never);

    // The old shell was killed and a fresh one spawned in the new directory.
    expect(spawns[0]?.fake.killed()).toBe(true);
    expect(spawns).toHaveLength(2);
    expect(spawns[1]?.cwd).toBe("/workspace/b");
    expect(r2.find((f) => f.type === "ready")?.cwd).toBe("/workspace/b");
    // Clean screen: workspace A's output is not replayed to the new client.
    expect(r2.some((f) => f.type === "data" && String(f.data).includes("output-from-a"))).toBe(
      false,
    );

    session.dispose();
  });

  it("spawns a real shell via node-pty end-to-end (output + exit)", async () => {
    // No spawnPty stub: exercises the real native binding + spawn-helper.
    h = await buildTerminalHarness({ shell: "/bin/echo", shellArgs: ["TERMINAL_E2E_OK"] });
    const token = await h.csrfToken();
    const socket = await h.app.injectWS(`/ws/terminal?csrf=${encodeURIComponent(token)}`, {
      headers: { origin: ORIGIN },
    });
    const frames = collect(socket);
    await frames.waitFor((f) => f.type === "ready");
    const data = await frames.waitFor(
      (f) => f.type === "data" && String(f.data).includes("TERMINAL_E2E_OK"),
    );
    expect(data.data).toContain("TERMINAL_E2E_OK");
    await frames.waitFor((f) => f.type === "exit");
  });
});
