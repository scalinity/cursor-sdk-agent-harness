import { useCallback, useEffect, useState } from "react";
import { runSummarySchema, type RunSummary } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useRunStore } from "../state/run-store.js";

export interface UseRunSummaryResult {
  run: RunSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useRunSummary(runId: string | null): UseRunSummaryResult {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upsertRunSummary = useRunStore((s) => s.upsertRunSummary);

  const reload = useCallback(async () => {
    if (!runId) {
      setRun(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await httpRequest(`/api/runs/${runId}`, { responseSchema: runSummarySchema });
      setRun(next);
      upsertRunSummary(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "run load failed");
    } finally {
      setLoading(false);
    }
  }, [runId, upsertRunSummary]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { run, loading, error, reload };
}
