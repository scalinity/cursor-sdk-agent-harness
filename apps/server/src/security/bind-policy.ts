/**
 * Bind policy. Centralizes the "127.0.0.1 unless ALLOW_REMOTE_BIND=true" rule
 * so it can be reused by the env loader (parse-time) and by startup tests.
 *
 * Loopback hosts: `127.0.0.1`, `localhost`, `::1`.
 */

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface BindCheckResult {
  ok: boolean;
  host: string;
  reason?: string;
}

export function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export function checkBind(host: string, allowRemote: boolean): BindCheckResult {
  if (isLoopback(host)) return { ok: true, host };
  if (allowRemote) return { ok: true, host };
  return {
    ok: false,
    host,
    reason: `Non-loopback HOST=${host} requires ALLOW_REMOTE_BIND=true`,
  };
}

export class BindPolicyError extends Error {
  constructor(public readonly host: string) {
    super(
      `Refusing to bind to non-loopback host '${host}'. Set ALLOW_REMOTE_BIND=true to override.`,
    );
    this.name = "BindPolicyError";
  }
}

export function assertBindAllowed(host: string, allowRemote: boolean): void {
  const result = checkBind(host, allowRemote);
  if (!result.ok) {
    throw new BindPolicyError(host);
  }
}
