import { chmodSync, constants as fsConstants, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { TerminalServerFrame } from "@harness/shared";

const require = createRequire(import.meta.url);

/**
 * Minimal structural view of a node-pty process. Declared locally so the
 * session manager stays decoupled from node-pty's types and so tests can
 * inject a fake without loading the native addon.
 */
export interface PtyProcess {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number | undefined }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface SpawnPtyOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export type SpawnPty = (opts: SpawnPtyOptions) => PtyProcess;

/** Anything the session needs to push a frame to one attached client. */
export interface TerminalClient {
  send(frame: TerminalServerFrame): void;
}

export interface TerminalViewport {
  cols: number;
  rows: number;
}

export interface TerminalLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface CreateTerminalSessionOptions {
  /**
   * Resolves the directory the shell should start in — the active workspace
   * (allowlist-resolved) or the user's home directory. May be async (the
   * workspace realpath check is). Should itself fall back to home; the session
   * additionally guards with `os.homedir()` if this rejects.
   */
  resolveCwd: () => string | Promise<string>;
  logger: TerminalLogger;
  /** Defaults to `$SHELL` or `/bin/zsh`. */
  shell?: string;
  /** Defaults to a login interactive shell (`-l`). */
  shellArgs?: string[];
  /** Injected for tests; defaults to node-pty. */
  spawnPty?: SpawnPty;
  /**
   * Base environment for the child. Defaults to a scrubbed copy of
   * `process.env` (Cursor API key removed). Injected in tests.
   */
  env?: Record<string, string>;
  /** Ring-buffer cap in characters. Defaults to 256 KiB. */
  ringBufferChars?: number;
}

const DEFAULT_RING_BUFFER_CHARS = 256 * 1024;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Owns a single long-lived PTY shared by all attached `/ws/terminal` clients
 * (single-user harness ⇒ normally one). The PTY is spawned lazily on first
 * attach, survives client detach (tab switch / reload), and is killed only on
 * `dispose()` (server shutdown). A ring buffer of recent output lets a
 * (re)attaching client restore its screen.
 *
 * Terminal I/O is deliberately ephemeral: it is NEVER persisted to the events
 * table or routed through the run bus.
 */
export class TerminalSession {
  private readonly opts: Required<Pick<CreateTerminalSessionOptions, "resolveCwd" | "logger">> & {
    shell: string;
    shellArgs: string[];
    spawnPty: SpawnPty;
    env: Record<string, string>;
    ringBufferChars: number;
  };

  private pty: PtyProcess | null = null;
  private starting: Promise<void> | null = null;
  /** Consecutive spawn failures; capped to stop infinite retry loops. */
  private spawnFailures = 0;
  private static readonly MAX_SPAWN_FAILURES = 5;
  private readonly clients = new Set<TerminalClient>();
  private cols = DEFAULT_COLS;
  private rows = DEFAULT_ROWS;
  private cwd = os.homedir();
  /** Recent raw output for screen restore on reattach. */
  private ring: string[] = [];
  private ringLen = 0;
  private disposed = false;

  constructor(options: CreateTerminalSessionOptions) {
    this.opts = {
      resolveCwd: options.resolveCwd,
      logger: options.logger,
      shell: options.shell ?? process.env.SHELL ?? "/bin/zsh",
      shellArgs: options.shellArgs ?? ["-l"],
      spawnPty: options.spawnPty ?? defaultSpawnPty,
      env: scrubbedEnv(options.env),
      ringBufferChars: options.ringBufferChars ?? DEFAULT_RING_BUFFER_CHARS,
    };
  }

  /**
   * Attach a client. Spawns the PTY if needed, then sends `ready` plus the
   * buffered screen. Returns a detach function. The PTY is NOT killed on
   * detach — it is long-lived.
   */
  async attach(client: TerminalClient, initialViewport?: TerminalViewport): Promise<() => void> {
    if (this.disposed) {
      client.send({ type: "error", message: "Terminal is shutting down" });
      return () => {};
    }
    if (initialViewport) {
      this.resize(initialViewport.cols, initialViewport.rows);
    }
    // If the active workspace changed since the live shell was spawned, replace
    // it with a fresh shell rooted in the new directory before (re)attaching.
    await this.reconcileWorkspaceCwd();
    try {
      await this.ensureStarted();
      await this.reconcileWorkspaceCwd();
      await this.ensureStarted();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start shell";
      this.opts.logger.error({ err }, "terminal: spawn failed");
      client.send({ type: "error", message });
      return () => {};
    }
    // Defer the initial frames one macrotask so a freshly-dialed socket has a
    // turn to attach its message listener before we push (mirrors the ws
    // heartbeat setImmediate rationale in ws-plugin). Output produced during
    // this gap lands in the ring buffer and rides out in the replay below, so
    // ordering stays ready → buffered screen → live.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (this.disposed) {
      client.send({ type: "error", message: "Terminal is shutting down" });
      return () => {};
    }
    this.clients.add(client);
    client.send({ type: "ready", cols: this.cols, rows: this.rows, cwd: this.cwd });
    if (this.ringLen > 0) {
      client.send({ type: "data", data: this.ring.join("") });
    }
    return () => {
      this.clients.delete(client);
    };
  }

  /** Write client keystrokes to the PTY. */
  write(data: string): void {
    this.pty?.write(data);
  }

  /** Apply a viewport resize (last-writer-wins across clients). */
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.pty?.resize(cols, rows);
  }

  /** Kill the PTY and drop all clients. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clients.clear();
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
        // already dead
      }
      this.pty = null;
    }
    this.ring = [];
    this.ringLen = 0;
  }

  private ensureStarted(): Promise<void> {
    if (this.pty) return Promise.resolve();
    if (this.starting) return this.starting;
    if (this.spawnFailures >= TerminalSession.MAX_SPAWN_FAILURES) {
      return Promise.reject(
        new Error(`Shell failed to start ${this.spawnFailures} consecutive times; giving up`),
      );
    }
    this.starting = this.spawn()
      .then(() => {
        this.spawnFailures = 0;
      })
      .catch((err: unknown) => {
        this.spawnFailures++;
        throw err;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  /**
   * If the resolved active-workspace directory differs from the directory the
   * live PTY was spawned in, kill the PTY so the next `ensureStarted` respawns
   * a fresh shell in the new directory. No-op when no PTY exists yet (the first
   * spawn picks up the current workspace) or the directory is unchanged. A real
   * shell can `cd` anywhere afterward, so this governs the *start* dir only —
   * consistent with how a run's cwd is chosen.
   */
  private async reconcileWorkspaceCwd(): Promise<void> {
    if (!this.pty) return;
    let desired: string;
    try {
      desired = await this.opts.resolveCwd();
    } catch {
      // Can't resolve right now — keep the current shell rather than guessing.
      return;
    }
    if (desired === this.cwd) return;
    this.opts.logger.info(
      { from: this.cwd, to: desired },
      "terminal: active workspace changed; respawning shell",
    );
    try {
      this.pty.kill();
    } catch {
      // already dead
    }
    // Drop the PTY + scrollback so ensureStarted() spawns fresh in `desired`
    // and the reattaching client restores a clean screen. The stale onData/
    // onExit guards (this.pty !== pty) keep the dying PTY from corrupting the
    // replacement that ensureStarted is about to create.
    this.pty = null;
    this.ring = [];
    this.ringLen = 0;
  }

  private async spawn(): Promise<void> {
    if (this.disposed) throw new Error("Terminal is shutting down");
    let cwd: string;
    try {
      cwd = await this.opts.resolveCwd();
    } catch (err) {
      this.opts.logger.warn({ err }, "terminal: cwd resolution failed; using home");
      cwd = os.homedir();
    }
    if (this.disposed) throw new Error("Terminal is shutting down");
    this.cwd = cwd;

    ensureSpawnHelperExecutable(this.opts.logger);
    if (this.disposed) throw new Error("Terminal is shutting down");

    const pty = this.opts.spawnPty({
      shell: this.opts.shell,
      args: this.opts.shellArgs,
      cwd,
      env: this.opts.env,
      cols: this.cols,
      rows: this.rows,
    });
    if (this.disposed) {
      try {
        pty.kill();
      } catch {
        // already dead
      }
      throw new Error("Terminal is shutting down");
    }

    pty.onData((data) => {
      if (this.pty !== pty) return; // stale output from a shell we replaced
      this.appendToRing(data);
      this.broadcast({ type: "data", data });
    });
    pty.onExit(({ exitCode, signal }) => {
      if (this.pty !== pty) return; // exit of a shell we already replaced
      this.broadcast({
        type: "exit",
        code: exitCode,
        ...(signal !== undefined ? { signal } : {}),
      });
      // The process is gone; reset so the next attach spawns a fresh shell
      // with a clean screen.
      this.pty = null;
      this.ring = [];
      this.ringLen = 0;
    });

    this.pty = pty;
  }

  private appendToRing(data: string): void {
    this.ring.push(data);
    this.ringLen += data.length;
    while (this.ringLen > this.opts.ringBufferChars && this.ring.length > 1) {
      const dropped = this.ring.shift();
      if (dropped === undefined) break;
      this.ringLen -= dropped.length;
    }
  }

  private broadcast(frame: TerminalServerFrame): void {
    for (const client of this.clients) {
      try {
        client.send(frame);
      } catch {
        // best-effort; a dead socket is cleaned up by its close handler
      }
    }
  }
}

/**
 * Known secret env vars to strip from the child shell. The harness keeps the
 * API key in the Keychain (not env) so `env` in the embedded terminal must
 * not surface it. `KEYCHAIN_SERVICE` is the Keychain account name itself —
 * harmless but unnecessary in the shell.
 */
const SCRUB_KEYS = new Set(["CURSOR_API_KEY", "KEYCHAIN_SERVICE"]);

/** Pattern-based strip for secret-shaped env vars the harness or CI might set.
 *  Errs on the side of caution — a missing var is easier to diagnose than a
 *  leaked one. */
const SCRUB_PATTERNS = [/TOKEN$/i, /SECRET$/i, /PASSWORD$/i, /_KEY$/i];

/**
 * Copy `process.env` into a plain string record, dropping known and
 * pattern-matched secrets and any undefined entries. Ensures a sane `TERM`.
 */
function scrubbedEnv(
  source: NodeJS.ProcessEnv | Record<string, string> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (SCRUB_KEYS.has(key)) continue;
    if (SCRUB_PATTERNS.some((p) => p.test(key))) continue;
    out[key] = value;
  }
  out.TERM = "xterm-256color";
  if (!out.COLORTERM) out.COLORTERM = "truecolor";
  return out;
}

/** Default node-pty-backed spawn. Lazily required so tests injecting a stub
 * never load the native addon. */
const defaultSpawnPty: SpawnPty = (opts) => {
  // node-pty is CJS with a native binding; require lazily and treat as
  // untyped at this isolated boundary (documented).
  const nodePty = require("node-pty") as {
    spawn(
      file: string,
      args: string[],
      options: {
        name: string;
        cols: number;
        rows: number;
        cwd: string;
        env: Record<string, string>;
      },
    ): PtyProcess;
  };
  return nodePty.spawn(opts.shell, opts.args, {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env,
  });
};

let helperChecked = false;

/**
 * node-pty forks a `spawn-helper` executable on macOS/Linux. Its prebuilt
 * binary can land without the execute bit under pnpm's content-addressed
 * store, which makes `posix_spawnp` fail. Best-effort: ensure +x once before
 * the first spawn. Covers fresh installs and the packaged app alike. Runs once
 * per process.
 */
function ensureSpawnHelperExecutable(logger: TerminalLogger): void {
  if (helperChecked) return;
  helperChecked = true;
  if (process.platform === "win32") return;
  try {
    const ptyEntry = require.resolve("node-pty");
    // .../node-pty/lib/index.js → .../node-pty
    const pkgDir = ptyEntry.slice(0, ptyEntry.lastIndexOf(`${path.sep}lib${path.sep}`));
    const candidates = [
      path.join(pkgDir, "build", "Release", "spawn-helper"),
      path.join(pkgDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ];
    for (const candidate of candidates) {
      let mode: number;
      try {
        mode = statSync(candidate).mode;
      } catch {
        continue; // not this layout
      }
      if ((mode & fsConstants.S_IXUSR) === 0) {
        chmodSync(candidate, 0o755);
        logger.info({ candidate }, "terminal: set +x on node-pty spawn-helper");
      }
    }
  } catch (err) {
    logger.warn({ err }, "terminal: could not verify spawn-helper permissions");
  }
}
