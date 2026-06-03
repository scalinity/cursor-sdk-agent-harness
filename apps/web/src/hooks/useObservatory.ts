import { useCallback, useEffect, useState } from "react";
import type { CounterSnapshot, ObservabilityPerfResponse, ObservabilityStatsResponse } from "@harness/shared";
import {
  observabilityPerfResponseSchema,
  observabilityStatsResponseSchema,
} from "@harness/shared";
import { HttpError, httpRequest } from "../lib/http-client.js";

export interface UseObservatoryResult {
  perf: ObservabilityPerfResponse | null;
  stats: ObservabilityStatsResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const EMPTY: UseObservatoryResult = {
  perf: null,
  stats: null,
  loading: false,
  error: null,
  reload: async () => {},
};

export function useObservatory(): UseObservatoryResult {
  const [perf, setPerf] = useState<ObservabilityPerfResponse | null>(null);
  const [stats, setStats] = useState<ObservabilityStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextPerf, nextStats] = await Promise.all([
        httpRequest("/api/observability/perf", { responseSchema: observabilityPerfResponseSchema }),
        httpRequest("/api/observability/stats", { responseSchema: observabilityStatsResponseSchema }),
      ]);
      setPerf(nextPerf);
      setStats(nextStats);
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Failed to load observatory telemetry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const [nextPerf, nextStats] = await Promise.all([
          httpRequest("/api/observability/perf", { responseSchema: observabilityPerfResponseSchema }),
          httpRequest("/api/observability/stats", { responseSchema: observabilityStatsResponseSchema }),
        ]);
        if (!cancelled) {
          setPerf(nextPerf);
          setStats(nextStats);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof HttpError ? e.message : "Failed to load observatory telemetry");
        }
      } finally {
        if (!cancelled && showLoading) setLoading(false);
      }
    };

    void refresh(true);
    const interval = window.setInterval(() => {
      void refresh(false);
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return { perf, stats, loading, error, reload };
}

export function formatCounterMs(snapshot: CounterSnapshot | undefined): string {
  if (!snapshot || snapshot.count === 0 || snapshot.p50 === null) return "--";
  return `${snapshot.p50.toFixed(1)} ms p50 · ${snapshot.p95?.toFixed(1) ?? "--"} ms p95`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export { EMPTY as EMPTY_OBSERVATORY };
