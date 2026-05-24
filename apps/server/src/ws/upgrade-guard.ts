import type { FastifyRequest } from "fastify";
import type { WsErrorCode } from "@harness/shared";
import type { CsrfTokenizer } from "../security/csrf.js";

/**
 * Shared WebSocket upgrade authorization for every WS route in the harness
 * (`/ws` run events and `/ws/terminal`). Browsers can't attach custom headers
 * to a WS upgrade, so the CSRF token rides in the `?csrf=` query param; the
 * Origin header is matched against the same allowlist the REST origin policy
 * uses. Both gates must pass before any handlers are attached.
 */
export interface WsUpgradeAuthOptions {
  csrf: CsrfTokenizer;
  /** Single allowed origin (Phase 05 back-compat). */
  allowedOrigin?: string;
  /** Multi-origin form (Phase 16: dev Vite origin + Electron `app://harness`). */
  allowedOrigins?: ReadonlyArray<string>;
}

/**
 * Returns an error descriptor when the upgrade must be rejected, or `null`
 * when it may proceed. Callers close the socket with code 1008 (policy
 * violation) on a non-null result.
 */
export function validateWsUpgrade(
  req: FastifyRequest,
  opts: WsUpgradeAuthOptions,
): { code: WsErrorCode; message: string } | null {
  const origin = req.headers.origin;
  const allowed = new Set<string>();
  if (opts.allowedOrigin) allowed.add(opts.allowedOrigin);
  for (const o of opts.allowedOrigins ?? []) allowed.add(o);
  if (!origin || !allowed.has(origin)) {
    return { code: "UNAUTHORIZED_ORIGIN", message: "Origin not allowed" };
  }
  const query = req.query as { csrf?: string } | undefined;
  const token = query?.csrf;
  if (typeof token !== "string" || token.length === 0) {
    return { code: "CSRF_FAILED", message: "Missing csrf query parameter" };
  }
  if (!opts.csrf.validate(token)) {
    return { code: "CSRF_FAILED", message: "Invalid CSRF token" };
  }
  return null;
}
