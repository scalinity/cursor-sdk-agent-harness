/**
 * useActiveWorkspace — wraps the Phase 16 active-workspace endpoints. The
 * active workspace is a single row of the existing allowlist promoted to
 * "current"; persistence lives server-side under settings key
 * `app.activeWorkspaceId` so it survives both launches and DB resets.
 *
 * State (workspace / activeWorkspaceId / loading / error) is stored on
 * `useUiStore` rather than per-hook useState. AppShell reads it to gate the
 * WorkspaceRequiredModal; the picker calls `setActive` after a successful
 * pick. Without shared state those two hook instances would each hold an
 * isolated copy and the modal would never observe the picker's update.
 */
import { useCallback } from "react";
import { activeWorkspaceResponseSchema, type WorkspaceAllowlistRow } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
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

// Module-scoped in-flight promise dedupes concurrent reloads across every
// `useActiveWorkspace` consumer (and StrictMode's double-mount). Mirrors
// the `useCsrfToken` pattern.
let reloadInFlight: Promise<void> | null = null;

// Test-only: clear the in-flight promise. Module state is cached across
// vitest test files, so a hung fetch in one test would otherwise leave a
// stale promise that the next test short-circuits on.
export function __resetForTests(): void {
  reloadInFlight = null;
}

export function useActiveWorkspace(): UseActiveWorkspaceResult {
  const workspace = useUiStore((s) => s.activeWorkspace);
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId);
  const loading = useUiStore((s) => s.activeWorkspaceLoading);
  const error = useUiStore((s) => s.activeWorkspaceError);
  const mutate = useMutatingRequest();

  const reload = useCallback(async (): Promise<void> => {
    if (reloadInFlight) return reloadInFlight;
    const store = useUiStore.getState();
    store.setActiveWorkspaceLoading(true);
    store.setActiveWorkspaceError(null);
    const promise = (async (): Promise<void> => {
      try {
        const res = await httpRequest("/api/workspace-allowlist/active", {
          responseSchema: activeWorkspaceResponseSchema,
        });
        useUiStore.getState().setActiveWorkspaceData({
          workspace: res.workspace,
          activeWorkspaceId: res.activeWorkspaceId,
        });
      } catch (e) {
        useUiStore
          .getState()
          .setActiveWorkspaceError(
            e instanceof Error ? e.message : "active workspace load failed",
          );
      } finally {
        useUiStore.getState().setActiveWorkspaceLoading(false);
        reloadInFlight = null;
      }
    })();
    reloadInFlight = promise;
    return promise;
  }, []);

  const setActive = useCallback(
    async (id: string | null) => {
      const res = await mutate("/api/workspace-allowlist/active", {
        method: "PUT",
        body: { id },
        responseSchema: activeWorkspaceResponseSchema,
      });
      useUiStore.getState().setActiveWorkspaceData({
        workspace: res.workspace,
        activeWorkspaceId: res.activeWorkspaceId,
      });
    },
    [mutate],
  );

  useMountEffect(() => {
    void reload();
  });

  return { workspace, activeWorkspaceId, loading, error, reload, setActive };
}
