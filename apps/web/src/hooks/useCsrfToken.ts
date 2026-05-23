/**
 * useCsrfToken — fetches `/api/security/csrf-token` once at mount and stores
 * the token in `ui-store`. Mutating REST calls and the WS upgrade depend on
 * this token, so this hook is the prerequisite for any network action.
 *
 * The token has a 4h TTL (set in `apps/server/src/security/csrf.ts`). For
 * Phase 08 we treat it as effectively long-lived; if a mutating call fails
 * with `CSRF_FAILED` the caller can trigger `refresh()` to re-mint.
 */
import { useCallback, useEffect, useState } from "react";
import { csrfTokenResponseSchema } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";

export interface UseCsrfTokenResult {
  token: string | null;
  /**
   * True only between the moment THIS hook instance initiated a fetch
   * and the moment it resolved. After F-002, the cold-start fetch is
   * shared across consumers via a module-scoped in-flight promise, so
   * a consumer that short-circuits on the existing promise never flips
   * its own `loading` to true. Treat `token === null && !error` as the
   * authoritative "still bootstrapping" signal across consumers.
   */
  loading: boolean;
  error: string | null;
  /** Refreshes the token and returns the new value (or null on failure). */
  refresh: () => Promise<string | null>;
}

// F-002: module-scoped in-flight promise. Hoisted out of the hook so all
// useCsrfToken consumers (and StrictMode's double-mount) share a single
// cold-start fetch. Without this, each hook instance had its own ref and
// they all raced — each writing a different freshly-minted token to
// ui-store, which made useWebSocket tear down + reconnect once per fetch.
let bootstrapInFlight: Promise<string | null> | null = null;

// Test-only: clear the module-scoped in-flight promise. Vitest doesn't
// reset module state between tests (modules are cached), so without
// this a test that hangs (e.g. unresolved fetch promise) leaves a stale
// bootstrapInFlight that the next test would short-circuit on.
export function __resetForTests(): void {
  bootstrapInFlight = null;
}

export function useCsrfToken(): UseCsrfTokenResult {
  const token = useUiStore((s) => s.csrfToken);
  const setCsrfToken = useUiStore((s) => s.setCsrfToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<string | null> => {
    if (bootstrapInFlight) return bootstrapInFlight;
    setLoading(true);
    setError(null);
    const promise = (async (): Promise<string | null> => {
      try {
        const res = await httpRequest("/api/security/csrf-token", {
          responseSchema: csrfTokenResponseSchema,
        });
        setCsrfToken(res.token);
        return res.token;
      } catch (e) {
        setError(e instanceof Error ? e.message : "csrf bootstrap failed");
        return null;
      } finally {
        setLoading(false);
        bootstrapInFlight = null;
      }
    })();
    bootstrapInFlight = promise;
    return promise;
  }, [setCsrfToken]);

  // Mount-only fetch. The hook is allowed to use useEffect — components must
  // route through this wrapper rather than fetch directly.
  useEffect(() => {
    if (token) return;
    void refresh();
  }, [token, refresh]);

  return { token, loading, error, refresh };
}
