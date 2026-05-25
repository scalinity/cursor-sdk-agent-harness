import type { ConnectionState } from "../../state/ui-store.js";

/**
 * Statusbar — bottom rail. Shows live-write indicator, model/ws status, and
 * a right-hand slot that surfaces the active workspace when idle and the
 * cancel-key hint while a run is in flight.
 */

export interface GitStatusInfo {
  branch: string | null;
  isDirty: boolean;
  ahead: number;
  behind: number;
  isGitRepo: boolean;
}

export interface StatusbarProps {
  connectionState: ConnectionState;
  modelLabel: string | null;
  runningRunId: string | null;
  /**
   * Phase 16 — active workspace label (or null when none is selected, but
   * the WorkspaceRequiredModal will be up in that case).
   */
  workspaceName?: string | null;
  /** Phase 19 — git status for the active workspace. */
  gitStatus?: GitStatusInfo;
  /** Phase 20 — number of active project rules in the workspace. */
  rulesCount?: number;
  /** Phase 23 — semantic index status badge. */
  indexStatus?:
    | { status: string; indexedFiles: number; totalFiles: number; totalChunks: number }
    | undefined;
}

function GitBranchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.5 1.5v5.585a2.5 2.5 0 1 0 1 0V7.5a1.5 1.5 0 0 0 1.5 1.5h1.085a2.5 2.5 0 1 0 0-1H7A.5.5 0 0 1 6.5 7.5V1.5a1 1 0 1 0-2 0ZM5 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5-3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Statusbar({
  connectionState,
  modelLabel,
  runningRunId,
  workspaceName,
  gitStatus,
  rulesCount,
  indexStatus,
}: StatusbarProps) {
  return (
    <div className="statusbar">
      <span className="inline-flex flex-none items-center gap-1.5 text-accent-primary">
        <span className="status-pulse" aria-hidden="true" />
        <span>{runningRunId ? `streaming · ${runningRunId.slice(0, 12)}` : "idle"}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
        {gitStatus?.isGitRepo ? (
          <span className="inline-flex items-center gap-1.5 text-text-tertiary">
            <GitBranchIcon className="size-3.5" />
            <span className="mono">{gitStatus.branch ?? "detached"}</span>
            {gitStatus.isDirty ? <span className="size-1.5 rounded-full bg-warning" aria-label="Uncommitted changes" /> : null}
            {gitStatus.ahead > 0 ? <span className="mono">{"↑"}{gitStatus.ahead}</span> : null}
            {gitStatus.behind > 0 ? <span className="mono">{"↓"}{gitStatus.behind}</span> : null}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent-primary" aria-hidden="true" />
          {modelLabel ?? "no model"}
        </span>
        {rulesCount != null && rulesCount > 0 ? (
          <>
            <span className="text-text-tertiary">·</span>
            <span className="inline-flex items-center gap-1 text-text-tertiary" title="Active project rules">
              Rules: {rulesCount}
            </span>
          </>
        ) : null}
        {indexStatus && indexStatus.status !== "pending" ? (
          <>
            <span className="text-text-tertiary">·</span>
            <span
              className="inline-flex items-center gap-1 text-text-tertiary"
              title="Semantic codebase index"
            >
              {indexStatus.status === "indexing"
                ? `Indexing ${
                    indexStatus.totalFiles > 0
                      ? Math.round((indexStatus.indexedFiles / indexStatus.totalFiles) * 100)
                      : 0
                  }%`
                : `Index: ${indexStatus.totalChunks}`}
            </span>
          </>
        ) : null}
        <span className="text-text-tertiary">·</span>
        <span className="inline-flex items-center gap-1.5">
          ws <span className={connectionState === "open" ? "text-success" : "text-warning"}>{connectionState}</span>
        </span>
      </span>
      <span className="ml-auto flex flex-none items-center gap-2.5 border-l border-border-subtle pl-2.5">
        {runningRunId ? (
          <span className="mono text-text-tertiary">⌘. cancel</span>
        ) : workspaceName ? (
          <span className="mono text-text-tertiary" title={workspaceName}>
            {workspaceName}
          </span>
        ) : null}
      </span>
    </div>
  );
}
