import { useUiStore } from "../../state/ui-store.js";
import { cn } from "../../lib/cn.js";

export interface TitlebarProps {
  onNewAgent?: () => void;
}

/**
 * Titlebar — traffic lights, repo crumb, branch/diff stats, code-toggle,
 * timer pill. Matches the mockup's `.titlebar` row using shell CSS for
 * layout and Tailwind utilities for token-driven colours/sizes.
 */
export function Titlebar({ onNewAgent }: TitlebarProps = {}) {
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

      {/* Repo crumb — TODO(phase-12): wire to active agent's cwd/git remote. */}
      <div className="flex h-full items-center gap-1.5 border-r border-border-subtle px-3 font-medium text-text-secondary">
        <span>cinder</span>
        <span className="text-text-tertiary">/</span>
        <span className="text-accent-primary">api-gateway</span>
      </div>

      {/* Branch / diff stats — TODO(phase-14): pull from server-side git
          metadata (run.final_result.git_metadata) once the panel is wired. */}
      <div className="flex h-full items-center gap-1.5 border-r border-border-subtle px-3 text-md text-text-secondary">
        <span className="mono text-sm">feat/pagination-cursor-fix</span>
        <span className="mono text-xs text-text-tertiary">·</span>
        <span className="mono text-xs text-success">+184</span>
        <span className="mono text-xs text-danger">−72</span>
      </div>

      <div className="flex-1" />

      {/* Right group */}
      <div className="flex items-center gap-1.5 pl-2">
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
        {/* TODO(phase-09): live run-duration timer (from activeRun.startedAt). */}
        <span className="inline-flex h-control-md items-center gap-1.5 rounded-md border border-border-subtle bg-surface-1 px-2 text-md font-medium text-text-secondary">
          12m 04s
        </span>
      </div>
    </div>
  );
}
