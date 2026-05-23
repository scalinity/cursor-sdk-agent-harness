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

export function useRunHistory(filters: RunHistoryFilters = {}): UseRunHistoryResult {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsertRunSummary = useRunStore((s) => s.upsertRunSummary);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number | undefined> = {};
      if (filters.agentId) query.agentId = filters.agentId;
      query.limit = filters.limit ?? 100;
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
  }, [filters.agentId, filters.limit, upsertRunSummary]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { runs, loading, error, reload };
}
