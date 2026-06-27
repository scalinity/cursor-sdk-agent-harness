/**
 * ApprovalPrompt — Phase 13 inline timeline surface.
 *
 * Renders one pending or resolved approval at its position in the
 * timeline (keyed by the originating `request.created` event seq).
 * Shows context (nearest task above, nearest running tool above), the
 * raw payload via `JsonInspector`, and Approve/Deny actions when
 * pending. On `APPROVAL_UNIMPLEMENTED` it surfaces a non-dismissable
 * banner that the SDK doesn't expose a resolver — never lying about
 * resolution.
 */
import { useMemo, useState } from "react";
import { JsonInspector } from "./JsonInspector.js";
import {
  useRunStore,
  type ApprovalState,
  type CanonicalRunEvent,
} from "../../state/run-store.js";

export interface ApprovalPromptProps {
  runId: string;
  approval: ApprovalState;
  onResolve: (
    requestId: string,
    decision: "approve" | "deny",
    reason?: string,
  ) => void;
}

function findContext(
  chunks: ReadonlyArray<ReadonlyArray<CanonicalRunEvent>>,
  upTo: number,
): { task: CanonicalRunEvent | null; toolCall: CanonicalRunEvent | null } {
  let task: CanonicalRunEvent | null = null;
  let toolCall: CanonicalRunEvent | null = null;
  for (let chunkIndex = chunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
    const chunk = chunks[chunkIndex];
    if (!chunk) continue;
    for (let i = chunk.length - 1; i >= 0; i -= 1) {
      const evt = chunk[i];
      if (!evt || evt.seq >= upTo) continue;
      if (toolCall === null && evt.sdk_type === "tool_call" && evt.kind === "tool_call.running") {
        toolCall = evt;
      }
      if (task === null && evt.sdk_type === "task") {
        task = evt;
      }
      if (task !== null && toolCall !== null) return { task, toolCall };
    }
  }
  return { task, toolCall };
}

function getTaskText(evt: CanonicalRunEvent | null): string | null {
  if (!evt) return null;
  const p = evt.payload as { text?: unknown } | null;
  if (p && typeof p === "object" && typeof p.text === "string") return p.text;
  return null;
}

function getToolName(evt: CanonicalRunEvent | null): string | null {
  if (!evt) return null;
  const p = evt.payload as { name?: unknown } | null;
  if (p && typeof p === "object" && typeof p.name === "string") return p.name;
  return null;
}

function ApprovalStatusBadge({ approval }: { approval: ApprovalState }) {
  if (approval.status === "pending") {
    return <span className="text-xs text-text-tertiary">Awaiting your response</span>;
  }
  if (approval.status === "resolved") {
    return (
      <span className="text-xs text-success">
        ✓ {approval.decision === "approve" ? "Approved" : "Denied"}
      </span>
    );
  }
  return <span className="text-xs text-danger">✗ {approval.code ?? "Failed"}</span>;
}

export function ApprovalPrompt({
  runId,
  approval,
  onResolve,
}: ApprovalPromptProps) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const requestEvent = useRunStore((s) =>
    s.eventsByRunId[runId]?.bySeq.get(approval.requestSeq) ?? null,
  );
  const eventChunks = useRunStore((s) => s.eventsByRunId[runId]?.eventChunks ?? null);
  const context = useMemo(
    () => findContext(eventChunks ?? [], approval.requestSeq),
    [eventChunks, approval.requestSeq],
  );

  const pending = approval.status === "pending";
  const isUnimplemented =
    approval.status === "failed" && approval.code === "APPROVAL_UNIMPLEMENTED";

  return (
    <div className="approval-prompt my-3 rounded-md border border-warning bg-surface-2 px-3 py-2 text-md">
      <div className="approval-prompt__head flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-warning">Permission requested</span>
          <span className="mono text-xs text-text-tertiary">
            req {approval.requestId.slice(0, 8)}
          </span>
        </div>
        <ApprovalStatusBadge approval={approval} />
      </div>

      <div className="approval-prompt__context mt-1 space-y-1">
        {context.task ? (
          <div className="text-xs text-text-secondary">
            <span className="mono text-text-tertiary">task:</span>{" "}
            {getTaskText(context.task) ?? "—"}
          </div>
        ) : null}
        {context.toolCall ? (
          <div className="text-xs text-text-secondary">
            <span className="mono text-text-tertiary">tool:</span>{" "}
            <span className="mono">{getToolName(context.toolCall)}</span>
          </div>
        ) : null}
      </div>

      {requestEvent ? (
        <details className="approval-prompt__inspect mt-2 text-xs">
          <summary className="cursor-pointer text-text-tertiary">
            payload
          </summary>
          <div className="mt-1 rounded-sm bg-surface-1 p-2">
            <JsonInspector label="request payload" value={requestEvent.payload} />
          </div>
        </details>
      ) : null}

      {isUnimplemented ? (
        <div
          role="alert"
          className="approval-prompt__banner mt-2 rounded-sm border border-warning bg-surface-1 px-2 py-1 text-xs text-warning"
        >
          This Cursor SDK version does not expose an approval method.
          Cannot resolve.
        </div>
      ) : null}

      {pending ? (
        <div className="approval-prompt__actions mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onResolve(approval.requestId, "approve")}
            className="inline-flex h-control-sm items-center rounded-sm border border-success bg-success px-2 text-xs font-medium text-surface-1"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() =>
              onResolve(
                approval.requestId,
                "deny",
                reason.length > 0 ? reason : undefined,
              )
            }
            className="inline-flex h-control-sm items-center rounded-sm border border-danger bg-surface-1 px-2 text-xs font-medium text-danger"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => setShowReason((v) => !v)}
            className="inline-flex h-control-sm items-center rounded-sm border border-border-subtle bg-surface-1 px-2 text-xs text-text-secondary"
          >
            {showReason ? "Hide reason" : "Add reason"}
          </button>
          {showReason ? (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you denying this?"
              rows={2}
              className="w-full rounded-sm border border-border-subtle bg-surface-1 p-1.5 text-xs text-text-primary"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
