import { pino, stdTimeFunctions, type Logger, type LoggerOptions } from "pino";

/**
 * Pino redaction paths applied to every server-side log call.
 *
 * Why this exact list:
 * - `apiKey`, `CURSOR_API_KEY`, `Authorization`: top-level fields that frequently
 *   appear in logged objects when copying request payloads or env snapshots.
 * - `headers.authorization` / `headers.Authorization`: case variants Fastify
 *   normalizes but third-party libs may emit unchanged.
 * - `headers['x-csrf-token']` / `headers['X-CSRF-Token']`: the CSRF token
 *   itself is not a secret per request, but the validating HMAC seed is — be
 *   conservative and redact at the wire.
 * - `*.token`, `*.secret`, `*.password`, `*.key`: catch MCP config blocks,
 *   pricing inputs, and any future config object that happens to nest a
 *   credential.
 * - `config.*.token`, `config.*.secret`: explicit MCP `config.*` patterns
 *   because the wildcard above only matches one level.
 */
export const REDACT_PATHS = [
  "apiKey",
  "CURSOR_API_KEY",
  "Authorization",
  "headers.authorization",
  "headers.Authorization",
  "headers['x-csrf-token']",
  "headers['X-CSRF-Token']",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-csrf-token']",
  "*.token",
  "*.secret",
  "*.password",
  "*.key",
  "config.*.token",
  "config.*.secret",
];

export const REDACT_CONFIG = {
  paths: REDACT_PATHS,
  censor: "[REDACTED]",
  remove: false,
} as const satisfies NonNullable<LoggerOptions["redact"]>;

export function createLogger(level: LoggerOptions["level"] = "info"): Logger {
  return pino({
    level,
    redact: REDACT_CONFIG,
    base: { service: "cursor-sdk-agent-harness" },
    timestamp: stdTimeFunctions.isoTime,
  });
}

export type AppLogger = Logger;
