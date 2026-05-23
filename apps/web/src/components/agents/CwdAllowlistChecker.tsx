import type { CwdDecision } from "../../hooks/useWorkspaceAllowlist.js";

export interface CwdAllowlistCheckerProps {
  decision: CwdDecision | null;
  loading: boolean;
  onAddToAllowlist: () => void;
  onRevalidate: () => void;
}

function reasonLabel(reason: Extract<CwdDecision, { allowed: false }>["reason"]): string {
  switch (reason) {
    case "not_allowlisted":
      return "Not in workspace allowlist";
    case "missing":
      return "Path doesn't exist on disk";
    case "symlink_escape":
      return "Symlink escapes the resolved path";
  }
}

/**
 * Small status row that lives next to a cwd input in the New Agent
 * dialog. Renders one of three states:
 *   - loading: ellipsis while the batch validate request is in flight
 *   - allowed=true: green check + the resolved realpath
 *   - allowed=false: red/yellow warning + reason + "Add to allowlist"
 *     button when the reason is `not_allowlisted` (the only branch
 *     where adding is meaningful).
 */
export function CwdAllowlistChecker({ decision, loading, onAddToAllowlist, onRevalidate }: CwdAllowlistCheckerProps) {
  if (loading) {
    return (
      <span className="text-xs text-text-tertiary" aria-live="polite">
        Validating…
      </span>
    );
  }
  if (decision === null) {
    return (
      <span className="text-xs text-text-tertiary">
        Not yet validated.{" "}
        <button
          type="button"
          className="underline"
          onClick={onRevalidate}
        >
          Re-check
        </button>
      </span>
    );
  }
  if (decision.allowed) {
    return (
      <span className="flex items-center gap-2 text-xs text-success">
        <span aria-hidden>✓</span>
        <span>Allowed</span>
        <code className="font-mono text-text-tertiary">{decision.normalizedPath}</code>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-warning" aria-hidden>
        ⚠
      </span>
      <span className="text-warning">{reasonLabel(decision.reason)}</span>
      <code className="font-mono text-text-tertiary">{decision.normalizedPath || "?"}</code>
      {decision.reason === "not_allowlisted" ? (
        <button
          type="button"
          className="rounded-sm border border-accent-soft px-2 py-0.5 text-xs text-accent-primary"
          onClick={onAddToAllowlist}
        >
          Add to allowlist
        </button>
      ) : null}
    </span>
  );
}
