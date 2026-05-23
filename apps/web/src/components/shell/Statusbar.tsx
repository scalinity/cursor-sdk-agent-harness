import type { ConnectionState } from "../../state/ui-store.js";

/**
 * Statusbar — bottom rail. Shows live-write indicator, model/subagents/mcp
 * status, and right-hand metrics. The animated pulse is Phase 14; this
 * phase uses a static accent dot.
 */
export interface StatusbarProps {
  connectionState: ConnectionState;
  modelLabel: string | null;
  runningRunId: string | null;
}

export function Statusbar({ connectionState, modelLabel, runningRunId }: StatusbarProps) {
  return (
    <div className="statusbar">
      <span className="inline-flex flex-none items-center gap-1.5 text-accent-primary">
        <span className="status-pulse" aria-hidden="true" />
        <span>{runningRunId ? `streaming · ${runningRunId.slice(0, 12)}` : "idle"}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent-primary" aria-hidden="true" />
          {modelLabel ?? "no model"}
        </span>
        <span className="text-text-tertiary">·</span>
        <span className="inline-flex items-center gap-1.5">
          ws <span className={connectionState === "open" ? "text-success" : "text-warning"}>{connectionState}</span>
        </span>
      </span>
      <span className="ml-auto flex flex-none gap-2.5 border-l border-border-subtle pl-2.5">
        <span>⌘. cancel</span>
      </span>
    </div>
  );
}
