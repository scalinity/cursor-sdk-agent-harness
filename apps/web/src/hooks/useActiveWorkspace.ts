/**
 * useActiveWorkspace — wraps the Phase 16 active-workspace endpoints. The
 * active workspace is a single row of the existing allowlist promoted to
 * "current"; persistence lives server-side under settings key
 * `app.activeWorkspaceId` so it survives both launches and DB resets.
 */
import { useCallback, useState } from "react";
import {
  activeWorkspaceResponseSchema,
  type WorkspaceAllowlistRow,
} from "@harness/shared";
import { httpRequest, mutatingRequest } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";
import { useMountEffect } from "./useMountEffect.js";

export interface UseActiveWorkspaceResult {
  workspace: WorkspaceAllowlistRow | null;
  activeWorkspaceId: string | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Promote `id` to active. Null clears the selection. */
  setActive: (id: string | null) => Promise<void>;
}

export function useActiveWorkspace(): UseActiveWorkspaceResult {
  const [workspace, setWorkspace] = useState<WorkspaceAllowlistRow | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshCsrfToken } = useCsrfToken();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpRequest("/api/workspace-allowlist/active", {
        responseSchema: activeWorkspaceResponseSchema,
      });
      setWorkspace(res.workspace);
      setActiveWorkspaceId(res.activeWorkspaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "active workspace load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const setActive = useCallback(
    async (id: string | null) => {
      const res = await mutatingRequest("/api/workspace-allowlist/active", {
        method: "PUT",
        body: { id },
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: activeWorkspaceResponseSchema,
      });
      setWorkspace(res.workspace);
      setActiveWorkspaceId(res.activeWorkspaceId);
    },
    [refreshCsrfToken],
  );

  useMountEffect(() => {
    void reload();
  });

  return { workspace, activeWorkspaceId, loading, error, reload, setActive };
}
