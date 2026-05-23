import { z } from "zod";
import type { CanonicalRunEvent } from "../../state/run-store.js";
import { cn } from "../../lib/cn.js";
import { safePayload, safeJsonString } from "../../lib/safe-payload.js";

const toolCallPayloadSchema = z
  .object({
    call_id: z.string().optional(),
    name: z.string().optional(),
    status: z.enum(["running", "completed", "error"]).optional(),
    args: z.unknown().optional(),
    result: z.unknown().optional(),
  })
  .nullable();

export interface ToolCallCardProps {
  event: CanonicalRunEvent;
}

/**
 * Phase 08: render every tool call as a single card with the tool name,
 * raw JSON args/result, and a status pill. Phase 09 builds the lane that
 * groups concurrent calls and adds icons per tool kind.
 */
export function ToolCallCard({ event }: ToolCallCardProps) {
  const p = safePayload(event.payload, toolCallPayloadSchema) ?? {};
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
