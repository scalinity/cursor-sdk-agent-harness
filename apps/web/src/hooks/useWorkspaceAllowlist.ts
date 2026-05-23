/**
 * useWorkspaceAllowlist — wraps `/api/workspace-allowlist` (list + add).
 * Phase 12 needs the inline quick-add hook for the NewAgentDialog cwd
 * input; the broader settings UI lands in a later phase.
 */
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  validateWorkspacePathResponseSchema,
  workspaceAllowlistRowSchema,
  type CreateWorkspaceAllowlistRequest,
  type WorkspaceAllowlistRow,
} from "@harness/shared";
import { httpRequest, mutatingRequest } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";

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
  validateMany: (paths: ReadonlyArray<string>) => Promise<Map<string, CwdDecision>>;
}

export function useWorkspaceAllowlist(): UseWorkspaceAllowlistResult {
  const [entries, setEntries] = useState<WorkspaceAllowlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshCsrfToken } = useCsrfToken();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpRequest("/api/workspace-allowlist", {
        responseSchema: listResponseSchema,
      });
      setEntries(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "allowlist load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(
    async (input: CreateWorkspaceAllowlistRequest) => {
      const created = await mutatingRequest("/api/workspace-allowlist", {
        method: "POST",
        body: input,
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: workspaceAllowlistRowSchema,
      });
      setEntries((prev) => [...prev, created]);
      return created;
    },
    [refreshCsrfToken],
  );

  const validateMany = useCallback(
    async (paths: ReadonlyArray<string>): Promise<Map<string, CwdDecision>> => {
      const result = new Map<string, CwdDecision>();
      if (paths.length === 0) return result;
      const res = await mutatingRequest("/api/workspace-allowlist/validate", {
        method: "POST",
        body: { paths: [...paths] },
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: validateBatchResponseSchema,
      });
      for (const item of res.results) result.set(item.input, item.decision);
      return result;
    },
    [refreshCsrfToken],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { entries, loading, error, reload, add, validateMany };
}
