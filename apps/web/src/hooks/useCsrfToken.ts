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
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCsrfToken(): UseCsrfTokenResult {
  const token = useUiStore((s) => s.csrfToken);
  const setCsrfToken = useUiStore((s) => s.setCsrfToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpRequest("/api/security/csrf-token", {
        responseSchema: csrfTokenResponseSchema,
      });
      setCsrfToken(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "csrf bootstrap failed");
    } finally {
      setLoading(false);
    }
  }, [setCsrfToken]);

  // Mount-only fetch. The hook is allowed to use useEffect — components must
  // route through this wrapper rather than fetch directly.
  useEffect(() => {
    if (token) return;
    void refresh();
  }, [token, refresh]);

  return { token, loading, error, refresh };
}
