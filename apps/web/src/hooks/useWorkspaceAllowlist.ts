/**
 * useWorkspaceAllowlist — wraps `/api/workspace-allowlist` (list + add).
 * Phase 12 needs the inline quick-add hook for the NewAgentDialog cwd
 * input; the broader settings UI lands in a later phase.
 */
import { useCallback } from "react";
import { z } from "zod";
import {
  validateWorkspacePathResponseSchema,
  workspaceAllowlistRowSchema,
  type CreateWorkspaceAllowlistRequest,
  type WorkspaceAllowlistRow,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useMountEffect } from "./useMountEffect.js";
import { useMutatingRequest } from "./useMutatingRequest.js";

const listResponseSchema = z.object({
  items: z.array(workspaceAllowlistRowSchema),
});

const validateBatchResponseSchema = z.object({
  results: z.array(
    z.object({
      input: z.string(),
      decision: validateWorkspacePathResponseSchema,
    }),
  ),
});

export type CwdDecision = z.infer<typeof validateWorkspacePathResponseSchema>;

export interface UseWorkspaceAllowlistResult {
  entries: WorkspaceAllowlistRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  add: (input: CreateWorkspaceAllowlistRequest) => Promise<WorkspaceAllowlistRow>;
  remove: (id: string) => Promise<void>;
  validateMany: (paths: ReadonlyArray<string>) => Promise<Map<string, CwdDecision>>;
}

// Module-scoped in-flight promise dedupes concurrent reloads across every
// consumer (sidebar, picker, WorkspaceSwitcher, NewAgentDialog) and
// StrictMode's double-mount. Mirrors the `useActiveWorkspace` pattern.
let reloadInFlight: Promise<void> | null = null;

// Test-only: clear the in-flight promise. Module state is cached across
// vitest test files, so a hung fetch in one test would otherwise leave a
// stale promise that the next test short-circuits on.
export function __resetForTests(): void {
  reloadInFlight = null;
}

export function useWorkspaceAllowlist(): UseWorkspaceAllowlistResult {
  // Entries/loading/error live on the shared store rather than per-hook
  // useState so every consumer observes the same allowlist; otherwise the
  // picker's `add` never reaches the sidebar's instance. See the
  // `workspaceAllowlist` slice in ui-store for the full rationale.
  const entries = useUiStore((s) => s.workspaceAllowlist);
  const loading = useUiStore((s) => s.workspaceAllowlistLoading);
  const error = useUiStore((s) => s.workspaceAllowlistError);
  const mutate = useMutatingRequest();

  const reload = useCallback(async (): Promise<void> => {
    if (reloadInFlight) return reloadInFlight;
    const store = useUiStore.getState();
    store.setWorkspaceAllowlistLoading(true);
    store.setWorkspaceAllowlistError(null);
    const promise = (async (): Promise<void> => {
      try {
        const res = await httpRequest("/api/workspace-allowlist", {
          responseSchema: listResponseSchema,
        });
        useUiStore.getState().setWorkspaceAllowlist(res.items);
      } catch (e) {
        useUiStore
          .getState()
          .setWorkspaceAllowlistError(
            e instanceof Error ? e.message : "allowlist load failed",
          );
      } finally {
        useUiStore.getState().setWorkspaceAllowlistLoading(false);
        reloadInFlight = null;
      }
    })();
    reloadInFlight = promise;
    return promise;
  }, []);

  const add = useCallback(
    async (input: CreateWorkspaceAllowlistRequest) => {
      const created = await mutate("/api/workspace-allowlist", {
        method: "POST",
        body: input,
        responseSchema: workspaceAllowlistRowSchema,
      });
      useUiStore.getState().addWorkspaceAllowlistEntry(created);
      return created;
    },
    [mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      // Server requires an explicit ?confirm=true to delete; it also clears the
      // active-workspace pointer first when the removed entry was active.
      await mutate(`/api/workspace-allowlist/${id}`, {
        method: "DELETE",
        query: { confirm: true },
      });
      useUiStore.getState().removeWorkspaceAllowlistEntry(id);
    },
    [mutate],
  );

  const validateMany = useCallback(
    async (paths: ReadonlyArray<string>): Promise<Map<string, CwdDecision>> => {
      const result = new Map<string, CwdDecision>();
      if (paths.length === 0) return result;
      const res = await mutate("/api/workspace-allowlist/validate", {
        method: "POST",
        body: { paths: [...paths] },
        responseSchema: validateBatchResponseSchema,
      });
      for (const item of res.results) result.set(item.input, item.decision);
      return result;
    },
    [mutate],
  );

  // REVIEW-S7: explicit mount-only hydration via useMountEffect wrapper.
  useMountEffect(() => {
    void reload();
  });

  return { entries, loading, error, reload, add, remove, validateMany };
}
