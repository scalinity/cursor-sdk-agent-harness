import type { CanonicalRunEvent } from "../../state/run-store.js";
import { cn } from "../../lib/cn.js";

export interface ToolCallCardProps {
  event: CanonicalRunEvent;
}

interface ToolCallPayload {
  call_id?: string;
  name?: string;
  status?: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
}

/**
 * Phase 08: render every tool call as a single card with the tool name,
 * raw JSON args/result, and a status pill. Phase 09 builds the lane that
 * groups concurrent calls and adds icons per tool kind.
 */
export function ToolCallCard({ event }: ToolCallCardProps) {
  const p = (event.payload as ToolCallPayload | null) ?? {};
  const statusClass =
    p.status === "error"
      ? "text-danger"
      : p.status === "completed"
        ? "text-success"
        : "text-accent-primary";

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border-subtle bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-md">
        <span className="mono font-medium text-text-primary">{p.name ?? "tool"}</span>
        <span className={cn("mono text-xs", statusClass)}>{p.status ?? "?"}</span>
        <span className="mono ml-auto text-xs text-text-tertiary">
          {p.call_id ? p.call_id.slice(0, 10) : ""}
        </span>
      </div>
      <div className="space-y-1 bg-background px-2.5 py-2 text-sm">
        {p.args !== undefined ? (
          <details className="text-text-secondary">
            <summary className="cursor-pointer text-text-tertiary">args</summary>
            <pre className="mono whitespace-pre-wrap text-xs text-text-primary">
              {safeJsonString(p.args)}
            </pre>
          </details>
        ) : null}
        {p.result !== undefined ? (
          <details className="text-text-secondary">
            <summary className="cursor-pointer text-text-tertiary">result</summary>
            <pre className="mono whitespace-pre-wrap text-xs text-text-primary">
              {safeJsonString(p.result)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
