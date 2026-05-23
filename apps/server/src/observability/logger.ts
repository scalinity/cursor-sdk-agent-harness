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

/**
 * Redact the `csrf` query parameter from a URL string. Used by the
 * Fastify request serializer so WS upgrade access logs (which include
 * `?csrf=<token>` because browsers can't add custom headers to a WS
 * upgrade) don't capture the token in plaintext.
 *
 * Pino's path-based redaction can't reach inside a URL string, so we
 * intercept at the serializer level. Handles both bare values
 * (`?csrf=ABC`) and URL-encoded ones (`?csrf=ABC%2Edef`). Case-
 * insensitive to match HTTP norms.
 */
export function redactCsrfFromUrl(url: string): string {
  if (typeof url !== "string" || url.length === 0) return url;
  // Match `csrf=<value>` up to the next `&` or end of string. The `i`
  // flag is case-insensitive; the `g` flag covers the (unlikely) case
  // where the param appears twice.
  return url.replace(/([?&])csrf=[^&]*/gi, "$1csrf=[REDACTED]");
}

/**
 * Fastify request serializer. Drop-in replacement for pino's default
 * that also strips CSRF tokens from the captured URL.
 */
export function safeReqSerializer(req: {
  id?: string | number;
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
  remotePort?: number;
}): Record<string, unknown> {
  return {
    ...(req.id !== undefined ? { id: req.id } : {}),
    ...(req.method !== undefined ? { method: req.method } : {}),
    ...(req.url !== undefined ? { url: redactCsrfFromUrl(req.url) } : {}),
    ...(req.headers !== undefined ? { headers: req.headers } : {}),
    ...(req.remoteAddress !== undefined ? { remoteAddress: req.remoteAddress } : {}),
    ...(req.remotePort !== undefined ? { remotePort: req.remotePort } : {}),
  };
}

export function createLogger(level: LoggerOptions["level"] = "info"): Logger {
  return pino({
    level,
    redact: REDACT_CONFIG,
    base: { service: "cursor-sdk-agent-harness" },
    timestamp: stdTimeFunctions.isoTime,
  });
}

export type AppLogger = Logger;
