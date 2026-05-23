/**
 * useRunHistory — wraps `/api/runs`. Phase 11 powers the run-history table
 * and the sessions rail from the same endpoint.
 */
import { useCallback, useEffect, useState } from "react";
import {
  listRunsResponseSchema,
  type RunSummary,
  type SdkRunStatus,
} from "@harness/shared";
import { httpRequest, mutatingRequest } from "../lib/http-client.js";
import { useRunStore } from "../state/run-store.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";

export type RunHistoryCostFilter = "any" | "available" | "unavailable" | "none";
export type RunHistorySort =
  | "started_desc"
  | "started_asc"
  | "duration_desc"
  | "duration_asc"
  | "cost_desc"
  | "cost_asc"
  | "tokens_desc"
  | "tokens_asc";

export interface RunHistoryFilters {
  agentId?: string | string[];
  status?: SdkRunStatus[];
  modelId?: string[];
  from?: string;
  to?: string;
  hasCost?: RunHistoryCostFilter;
  sort?: RunHistorySort;
  page?: number;
  pageSize?: number;
  limit?: number;
}

export interface UseRunHistoryResult {
  runs: RunSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  deleteRun: (runId: string) => Promise<void>;
  deleteRuns: (runIds: string[]) => Promise<void>;
}

function joinParam(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined;
}

export function useRunHistory({
  agentId,
  status,
  modelId,
  from,
  to,
  hasCost = "any",
  sort = "started_desc",
  page = 1,
  pageSize = 50,
  limit,
}: RunHistoryFilters = {}): UseRunHistoryResult {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsertRunSummary = useRunStore((s) => s.upsertRunSummary);
  const { refresh: refreshCsrfToken } = useCsrfToken();

  const statusParam = joinParam(status);
  const modelParam = joinParam(modelId);
  const agentParam = Array.isArray(agentId) ? joinParam(agentId) : agentId;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number | undefined> = {
        limit,
        page,
        pageSize,
        hasCost,
        sort,
      };
      if (agentParam) query.agentId = agentParam;
      if (statusParam) query.status = statusParam;
      if (modelParam) query.modelId = modelParam;
      if (from) query.from = from;
      if (to) query.to = to;
      const res = await httpRequest("/api/runs", {
        query,
        responseSchema: listRunsResponseSchema,
      });
      setRuns(res.items);
      setTotal(res.total);
      for (const r of res.items) upsertRunSummary(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "runs load failed");
    } finally {
      setLoading(false);
    }
  }, [agentParam, from, hasCost, limit, modelParam, page, pageSize, sort, statusParam, to, upsertRunSummary]);

  const deleteRun = useCallback(
    async (runId: string) => {
      await mutatingRequest(`/api/runs/${runId}`, {
        method: "DELETE",
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
      });
      await reload();
    },
    [refreshCsrfToken, reload],
  );

  const deleteRuns = useCallback(
    async (runIds: string[]) => {
      for (const runId of runIds) {
        await mutatingRequest(`/api/runs/${runId}`, {
          method: "DELETE",
          getCsrfToken: () => useUiStore.getState().csrfToken,
          refreshCsrfToken,
        });
      }
      await reload();
    },
    [refreshCsrfToken, reload],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { runs, total, loading, error, reload, deleteRun, deleteRuns };
}
