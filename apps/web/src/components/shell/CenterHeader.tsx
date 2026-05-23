import type { AgentSummary, RunSummary } from "@harness/shared";

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
  const title = activeRun?.promptPreview || activeAgent?.name || "No agent selected";
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
          {activeAgent ? activeAgent.modelId : "no model"}
        </span>
      </div>
    </div>
  );
}
