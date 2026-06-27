/**
 * MCP server validation probe.
 *
 * THREAT MODEL (REVIEW-W4)
 * ------------------------
 * The harness binds to loopback (127.0.0.1) by default and gates every
 * mutating REST route behind CSRF + Origin. `validateMcpServerConfig`
 * accepts a user-supplied stdio command and spawns it directly (no
 * shell). For the documented single-user local harness, this is
 * acceptable — an authenticated local caller is trusted to supply
 * commands that should run as the harness user.
 *
 * If `ALLOW_REMOTE_BIND=true` is ever set, or the CSRF/Origin gate is
 * relaxed, this module's threat surface widens dramatically and must
 * be re-evaluated before re-enabling the probe. The minimum changes
 * would include:
 *   - require a stronger authn proof than CSRF (e.g. a session bound
 *     to a verified user identity);
 *   - clamp `config.command` to a server-side allowlist (no
 *     arbitrary binaries);
 *   - clamp `config.cwd` to the workspace allowlist (today any path
 *     reaches `spawn`);
 *   - lift the env-allowlist below if upstream MCP servers need more.
 *
 * REVIEW-W3: parent env is restricted to a small allowlist so a
 * malicious command (`/bin/sh -c "env > /tmp/leak"`) cannot exfiltrate
 * bootstrap-time secrets like `CURSOR_API_KEY`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  mcpServerConfigSchema,
  type McpServerConfig,
} from "@harness/shared";

/**
 * Result of a single MCP server validation probe.
 *
 * Spec §5 → MCP Server CRUD enumerates four statuses: `unknown`, `valid`,
 * `invalid`, `unreachable`. The validator never returns `unknown` — that
 * is the persisted default on insert, and the route layer flips to one
 * of the three concrete outcomes after the probe runs.
 */
export type McpValidationResult =
  | { status: "valid"; transport: McpTransport; details?: string }
  | { status: "invalid"; reason: string }
  | { status: "unreachable"; reason: string; transport: McpTransport };

export type McpTransport = "stdio" | "http" | "sse";

export interface McpValidatorOptions {
  /**
   * Hard timeout for either probe variant. Default 3000ms; configurable via
   * `MCP_PROBE_TIMEOUT_MS`. Tests inject a tiny value (e.g. 50ms) so a hung
   * probe doesn't hold the suite.
   */
  timeoutMs?: number;
  /**
   * Override the fetch implementation for tests. Production uses globalThis.fetch.
   */
  fetchImpl?: typeof fetch;
  /**
   * Override `spawn` for tests. Production uses node:child_process spawn.
   * Signature mirrors the subset of behavior we exercise — full type would
   * pull in unused fields.
   */
  spawnImpl?: typeof spawn;
}

/**
 * REVIEW-S2: exported so the route layer resolves `MCP_PROBE_TIMEOUT_MS`
 * against the same default the validator itself uses, instead of
 * duplicating the literal.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const DEFAULT_TIMEOUT_MS = DEFAULT_PROBE_TIMEOUT_MS;

/**
 * Probe an MCP server configuration once.
 *
 * Validates the shape against `mcpServerConfigSchema` (verbatim from
 * OQ-18); rejects malformed JSON / shape-mismatch as `invalid`. For
 * verified configs it routes to the stdio or http/sse probe and reports
 * the outcome.
 *
 * The probe is intentionally narrow:
 * - stdio: spawn the configured command with a single `--help` arg.
 *   Anything that doesn't fail-to-spawn within the timeout is considered
 *   reachable. Exit code is informational and surfaced in `details`; we
 *   do not gate `valid` on exit 0 because well-behaved MCP servers may
 *   reject `--help` with a non-zero status (the contract is "the binary
 *   exists and runs").
 * - http/sse: HEAD or GET against the URL with the configured headers.
 *   2xx → valid. 4xx/5xx → invalid (server replied but rejected us).
 *   Network failure or timeout → unreachable.
 */
export async function validateMcpServerConfig(
  rawConfig: unknown,
  options: McpValidatorOptions = {},
): Promise<McpValidationResult> {
  const parsed = mcpServerConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue ? issue.path.join(".") || "(root)" : "(root)";
    const message = issue ? issue.message : "config schema mismatch";
    return {
      status: "invalid",
      reason: `${path}: ${message}`,
    };
  }
  const config = parsed.data;
  const transport: McpTransport =
    "command" in config ? "stdio" : (config.type ?? "http") === "sse" ? "sse" : "http";

  const timeoutMs = Math.max(50, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  if ("command" in config) {
    return probeStdio(config, transport, timeoutMs, options.spawnImpl ?? spawn);
  }
  return probeHttp(
    config,
    transport,
    timeoutMs,
    options.fetchImpl ?? globalThis.fetch.bind(globalThis),
  );
}

type StdioConfig = Extract<McpServerConfig, { command: string }>;
type HttpConfig = Extract<McpServerConfig, { url: string }>;

/**
 * REVIEW-W3: parent env vars the probe child is allowed to inherit.
 * Everything else (including `CURSOR_API_KEY` if bootstrapped via env)
 * is withheld so a malicious command can't exfiltrate the harness's
 * own secrets via the spawned subprocess.
 */
const PARENT_ENV_ALLOWLIST: ReadonlyArray<string> = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TZ",
];

function buildProbeEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const parent: NodeJS.ProcessEnv = {};
  for (const key of PARENT_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) parent[key] = value;
  }
  return { ...parent, ...(extra ?? {}) };
}

async function probeStdio(
  config: StdioConfig,
  transport: McpTransport,
  timeoutMs: number,
  spawnImpl: typeof spawn,
): Promise<McpValidationResult> {
  return await new Promise<McpValidationResult>((resolve) => {
    let settled = false;
    // REVIEW-W2: hoist `child` out of the TDZ — declared up-front as
    // `ChildProcess | undefined` so `resolveOnce` can null-check before
    // calling kill(). Future refactors that invoke resolveOnce before
    // the spawn won't throw ReferenceError.
    let child: ChildProcess | undefined;
    const resolveOnce = (result: McpValidationResult) => {
      if (settled) return;
      settled = true;
      if (child) {
        try {
          child.kill("SIGTERM");
        } catch {
          // best-effort: process may already be gone
        }
        // REVIEW-W2: SIGTERM is best-effort; a non-cooperative MCP
        // server can ignore it. Schedule an unref'd SIGKILL fallback
        // so a misbehaving binary doesn't accumulate zombies under
        // repeated re-probes.
        const c = child;
        const killTimer = globalThis.setTimeout(() => {
          try {
            c.kill("SIGKILL");
          } catch {
            // best-effort: process may have exited already
          }
        }, 250);
        killTimer.unref?.();
      }
      resolve(result);
    };

    try {
      child = spawnImpl(
        config.command,
        // Add `--help` as a probe argument unless caller already passes args.
        // Servers that ignore it should still exit promptly.
        config.args && config.args.length > 0 ? config.args : ["--help"],
        {
          stdio: ["ignore", "pipe", "pipe"],
          // REVIEW-W3: minimal parent env + caller-declared additions.
          env: buildProbeEnv(config.env),
          ...(config.cwd ? { cwd: config.cwd } : {}),
        },
      );
    } catch (err) {
      settled = true;
      resolve({
        status: "unreachable",
        transport,
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 2048) stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      // ENOENT for missing binary lands here.
      resolveOnce({
        status: "unreachable",
        transport,
        reason: err.message,
      });
    });

    child.on("exit", (code, signal) => {
      // REVIEW-S1: persist only the first line of stderr, bounded length.
      // Custom MCP binaries may write paths or credentials to stderr; a
      // multi-line dump in last_status / validation_message is a surface
      // we don't need. Full stderr is still observable via process logs
      // at debug verbosity.
      const firstStderrLine = stderr.split(/\r?\n/, 1)[0] ?? "";
      const truncated = firstStderrLine.slice(0, 200);
      const detail =
        signal !== null
          ? `terminated by ${signal}`
          : `exit ${code ?? "unknown"}${truncated ? `; stderr: ${truncated}` : ""}`;
      resolveOnce({
        status: "valid",
        transport,
        details: detail,
      });
    });

    void delay(timeoutMs).then(() => {
      if (!settled) {
        // Long-running stdio process is treated as a successful "reachable"
        // probe — MCP servers commonly do not exit on `--help` and start
        // listening on stdio. We've established the binary exists and
        // started, which is the contract for this phase.
        resolveOnce({
          status: "valid",
          transport,
          details: `did not exit within ${timeoutMs}ms (long-running server)`,
        });
      }
    });
  });
}

async function probeHttp(
  config: HttpConfig,
  transport: McpTransport,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<McpValidationResult> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = {
      method: "GET",
      signal: controller.signal,
    };
    if (config.headers) init.headers = config.headers;
    const resp = await fetchImpl(config.url, init);
    if (resp.status >= 200 && resp.status < 300) {
      return { status: "valid", transport, details: `HTTP ${resp.status}` };
    }
    if (resp.status >= 400) {
      let body = "";
      try {
        body = (await resp.text()).slice(0, 200);
      } catch {
        // ignore body read failure; status alone is signal enough
      }
      return {
        status: "invalid",
        reason: `HTTP ${resp.status}${body ? `: ${body}` : ""}`,
      };
    }
    // 1xx / 3xx — treat as reachable but unexpected; surface as valid with details.
    return {
      status: "valid",
      transport,
      details: `HTTP ${resp.status}`,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        status: "unreachable",
        transport,
        reason: `timed out after ${timeoutMs}ms`,
      };
    }
    return {
      status: "unreachable",
      transport,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/**
 * Token-like top-level keys we mask in API responses. Anything not on this
 * list but matching `*.token`/`*.secret`/`*.password`/`*.key` is also masked
 * by the recursive walker.
 */
const TOKEN_FIELDS_BY_VARIANT = {
  stdio: ["env"] as const,
  http: ["headers", "auth"] as const,
  sse: ["headers", "auth"] as const,
} as const;

const TOKEN_FIELD_PATTERN = /(token|secret|password|key|authorization)/i;

/**
 * Recursively mask token-like fields inside an MCP config so it can ride
 * over the wire to the frontend list view. Returns a structurally cloned
 * shape — never mutates the input.
 *
 * Stdio: `env` values are masked entirely (each var is treated as
 * potentially sensitive — `env: { GITHUB_TOKEN: "..." }` is the common
 * shape).
 * HTTP/SSE: header values matching the pattern + every `auth.*` field
 * except `CLIENT_ID` are masked.
 */
export function redactMcpConfig(config: McpServerConfig): McpServerConfig {
  if ("command" in config) {
    return {
      ...config,
      ...(config.env
        ? { env: Object.fromEntries(Object.keys(config.env).map((k) => [k, "[REDACTED]"])) }
        : {}),
    };
  }
  const next: HttpConfig = { ...config };
  if (config.headers) {
    next.headers = Object.fromEntries(
      Object.entries(config.headers).map(([k, v]) => [
        k,
        TOKEN_FIELD_PATTERN.test(k) ? "[REDACTED]" : v,
      ]),
    );
  }
  if (config.auth) {
    next.auth = {
      CLIENT_ID: config.auth.CLIENT_ID,
      ...(config.auth.CLIENT_SECRET !== undefined ? { CLIENT_SECRET: "[REDACTED]" } : {}),
      ...(config.auth.scopes ? { scopes: [...config.auth.scopes] } : {}),
    };
  }
  return next;
}

// Re-export to keep the variant list reachable from tests + routes without
// pulling the implementation surface in.
export const REDACTED_FIELDS = TOKEN_FIELDS_BY_VARIANT;
