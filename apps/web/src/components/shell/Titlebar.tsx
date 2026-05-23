import type { WorkspaceAllowlistRow } from "@harness/shared";
import { useUiStore } from "../../state/ui-store.js";
import { cn } from "../../lib/cn.js";

export interface TitlebarProps {
  onNewAgent?: () => void;
  /**
   * Phase 13 — when set, the titlebar shows a "Cancel run" button that
   * forwards the user's intent to `useAgentStream.cancelRun`. Hidden
   * when null/undefined (no active run).
   */
  onCancelRun?: () => void;
  /**
   * Phase 16 — the currently active workspace. Null until the user picks one;
   * the WorkspaceRequiredModal will then block the shell until they do.
   */
  workspace?: WorkspaceAllowlistRow | null;
  /**
   * Phase 16 — re-open the workspace picker. The titlebar crumb is the
   * primary affordance for switching workspaces.
   */
  onPickWorkspace?: () => void;
}

function workspaceLabel(ws: WorkspaceAllowlistRow): string {
  if (ws.label && ws.label.length > 0) return ws.label;
  // Show the basename of the path so the titlebar isn't dominated by
  // /Users/danny/Documents/.../actual-folder.
  const segments = ws.path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? ws.path;
}

export function Titlebar({
  onNewAgent,
  onCancelRun,
  workspace,
  onPickWorkspace,
}: TitlebarProps = {}) {
  const codeHidden = useUiStore((s) => s.codeHidden);
  const toggleCodeHidden = useUiStore((s) => s.toggleCodeHidden);
  return (
    <div className="titlebar">
      {/* Traffic lights */}
      <div className="flex gap-2 px-3.5">
        <span className="block size-3 rounded-full bg-danger" aria-hidden="true" />
        <span className="block size-3 rounded-full bg-warning" aria-hidden="true" />
        <span className="block size-3 rounded-full bg-success" aria-hidden="true" />
      </div>

      {/* Workspace crumb — Phase 16. Real workspace name, clickable to
          re-open the picker. Before a workspace is selected the
          WorkspaceRequiredModal blocks the shell, so this slot is the
          authoritative "current workspace" label. */}
      {workspace ? (
        <button
          type="button"
          onClick={onPickWorkspace}
          title={`Workspace: ${workspace.path} (click to switch)`}
          className="flex h-full items-center gap-1.5 border-r border-border-subtle bg-transparent px-3 font-medium text-text-secondary hover:text-text-primary"
        >
          <span className="mono text-xs text-text-tertiary">workspace</span>
          <span className="text-text-tertiary">/</span>
          <span className="text-accent-primary">{workspaceLabel(workspace)}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onPickWorkspace}
          className="flex h-full items-center gap-1.5 border-r border-border-subtle bg-transparent px-3 font-medium text-text-tertiary hover:text-text-primary"
        >
          <span>Pick workspace…</span>
        </button>
      )}

      {/* Branch / diff stats — intentionally hidden until a future phase
          ships real git integration. The mockup showed `feat/foo +n -m`
          here, but until we read git state from `workspace.path` any
          rendered string would be fiction. */}

      <div className="flex-1" />

      {/* Right group */}
      <div className="flex items-center gap-1.5 pl-2">
        {onCancelRun ? (
          <button
            type="button"
            onClick={onCancelRun}
            title="Cancel run (⌘.)"
            className="inline-flex h-control-md items-center gap-1.5 rounded-md border border-danger bg-surface-1 px-2 text-md font-medium text-danger hover:bg-surface-2"
          >
            <span>Cancel run</span>
            <span className="mono text-2xs text-text-tertiary">⌘.</span>
          </button>
        ) : null}
        {onNewAgent ? (
          <button
            type="button"
            onClick={onNewAgent}
            className="inline-flex h-control-md items-center gap-1.5 rounded-md border border-border-subtle bg-surface-1 px-2 text-md font-medium text-text-secondary hover:bg-surface-2"
          >
            <span>+ New agent</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={toggleCodeHidden}
          aria-pressed={codeHidden}
          title={codeHidden ? "Show code (⌘ J)" : "Hide code (⌘ J)"}
          className={cn(
            "inline-flex h-control-md items-center gap-1.5 rounded-md border px-2 text-md font-medium",
            "transition-colors duration-fast ease-standard",
            codeHidden
              ? "border-accent-soft bg-accent-bg text-accent-primary"
              : "border-border-subtle bg-surface-1 text-text-secondary hover:bg-surface-2",
          )}
        >
          <span>{codeHidden ? "Show code" : "Hide code"}</span>
          <span className="mono text-2xs text-text-tertiary">⌘J</span>
        </button>
        {/* Run-duration timer pill removed — the mockup showed "12m 04s"
            but no run-duration ticker has shipped yet. A future phase
            can re-add this once `useRunDuration(activeRunId)` exists. */}
      </div>
    </div>
  );
}
