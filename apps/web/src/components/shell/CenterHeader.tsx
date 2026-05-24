import { MODEL_LABELS, type AgentSummary, type RunSummary } from "@harness/shared";
import { useUiStore } from "../../state/ui-store.js";
import { describeModel } from "../../lib/model-label.js";

export interface CenterHeaderProps {
  activeAgent: AgentSummary | null;
  activeRun: RunSummary | null;
  toolCallCount: number;
  eventCount: number;
}

export function CenterHeader({
  activeAgent,
  activeRun,
  toolCallCount,
  eventCount,
}: CenterHeaderProps) {
  // The model is a standing user choice in the composer, independent of whether
  // the auto-provisioned agent has landed yet — so show the selected model even
  // before `activeAgent` exists (cold start) rather than "no model".
  const selectedModelId = useUiStore((s) => s.selectedModelId);
  const modelLabel = activeAgent
    ? describeModel(activeAgent).modelLabel
    : MODEL_LABELS[selectedModelId];
  const title = activeRun?.promptPreview || "New Chat";
  return (
    <div className="center-head">
      <div className="min-w-0 truncate text-base font-semibold">{title}</div>
      {activeRun ? (
        <div className="mono text-sm text-text-tertiary">
          · @ {activeRun.id.slice(0, 10)}
        </div>
      ) : null}
      <div className="ml-auto flex flex-none gap-1">
        <span className="inline-flex h-control-sm items-center gap-1.5 rounded-sm border border-border-subtle bg-surface-1 px-2 text-xs text-text-secondary">
          {toolCallCount} tool calls
        </span>
        <span className="inline-flex h-control-sm items-center gap-1.5 rounded-sm border border-border-subtle bg-surface-1 px-2 text-xs text-text-secondary">
          {eventCount} events
        </span>
        <span className="inline-flex h-control-sm items-center gap-1.5 rounded-sm px-2 text-xs text-text-secondary">
          {modelLabel}
        </span>
      </div>
    </div>
  );
}
