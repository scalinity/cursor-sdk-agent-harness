import { useMemo } from "react";
import { useRunStore } from "../state/run-store.js";
import { deriveContextBudget, type ContextBudget } from "@harness/shared";

/**
 * Derive the context-fill budget for a run. Returns null when runId is null
 * (no active run). Returns a budget with `usageSource: "unavailable"` + zero
 * fraction when the SDK hasn't delivered turn-ended usage yet.
 *
 * **Live-run limitation (v1):** The RunRecord's `lastTurnInputTokens` /
 * `lastTurnOutputTokens` are populated only via `upsertRunSummary` (REST
 * history fetch). The live WS path (`ingestServerFrame` / `run.final_result`)
 * does not carry per-turn context occupancy. So during a live streaming run
 * the gauge stays at its pre-run value or "unavailable" until the sessions
 * rail re-fetches history after the run finishes. A v2 `sdk.context_occupancy`
 * WS frame or extending `run.final_result` would close this gap.
 *
 * Pure derivation — no `useEffect`, no subscriptions beyond Zustand selectors.
 */
export function useContextBudget(runId: string | null): ContextBudget | null {
  const modelId = useRunStore((s) =>
    runId ? (s.byId[runId]?.modelId ?? null) : null,
  );
  const lastTurnInputTokens = useRunStore((s) =>
    runId ? (s.byId[runId]?.lastTurnInputTokens ?? null) : null,
  );
  const lastTurnOutputTokens = useRunStore((s) =>
    runId ? (s.byId[runId]?.lastTurnOutputTokens ?? null) : null,
  );

  return useMemo(() => {
    if (runId === null) return null;
    return deriveContextBudget({ modelId, lastTurnInputTokens, lastTurnOutputTokens });
  }, [runId, modelId, lastTurnInputTokens, lastTurnOutputTokens]);
}
