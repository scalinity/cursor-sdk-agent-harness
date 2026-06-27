import { useEffect, useRef } from "react";
import type { AgentSummary } from "@harness/shared";
import { useUiStore } from "../state/ui-store.js";

/**
 * Seed the composer's in-memory effort selection (`selectedModelParams`) from
 * the active agent's persisted `modelParams` whenever the active agent changes.
 *
 * `selectedModelParams` is in-memory only, so without this the persisted effort
 * would be lost on reload or agent switch and the effort control would fall back
 * to the model default. Re-seeding is keyed on the agent *id* — not the
 * `modelParams` reference, which gets a fresh array object on every poll — so a
 * just-made edit that hasn't round-tripped to the server yet is never clobbered.
 * Model switches reset params separately (via `setSelectedModelId`), so a same-id
 * model change doesn't need to re-seed here.
 */
export function useHydrateEffortSelection(activeAgent: AgentSummary | null): void {
  const setSelectedModelParams = useUiStore((s) => s.setSelectedModelParams);
  const lastAgentId = useRef<string | null>(null);
  useEffect(() => {
    const id = activeAgent?.id ?? null;
    if (id === lastAgentId.current) return;
    lastAgentId.current = id;
    setSelectedModelParams(activeAgent?.modelParams ?? []);
  }, [activeAgent, setSelectedModelParams]);
}
