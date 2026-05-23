/**
 * useRunHistory — wraps `/api/runs`. Phase 08 uses this to populate the
 * sessions rail (today/yesterday groupings).
 */
import { useCallback, useEffect, useState } from "react";
import { listRunsResponseSchema, type RunSummary } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useRunStore } from "../state/run-store.js";

export interface RunHistoryFilters {
  agentId?: string;
  limit?: number;
}

export interface UseRunHistoryResult {
  runs: RunSummary[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Filters are destructured at the signature with defaults so the effect's
 * dependencies are primitive values, not an object reference. Without this,
 * any caller writing `useRunHistory({ agentId })` inline would produce a
 * fresh object per parent render and trigger a full /api/runs refetch on
 * every render.
 */
export function useRunHistory({
  agentId,
  limit = 100,
}: RunHistoryFilters = {}): UseRunHistoryResult {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsertRunSummary = useRunStore((s) => s.upsertRunSummary);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number | undefined> = { limit };
      if (agentId) query.agentId = agentId;
      const res = await httpRequest("/api/runs", {
        query,
        responseSchema: listRunsResponseSchema,
      });
      setRuns(res.items);
      for (const r of res.items) upsertRunSummary(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "runs load failed");
    } finally {
      setLoading(false);
    }
  }, [agentId, limit, upsertRunSummary]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { runs, loading, error, reload };
}
