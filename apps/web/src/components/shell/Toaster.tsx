/**
 * Toaster — renders the UiStore toast queue. Without this surface, every
 * `useErrorReporter.report()` call in the app silently lands in the store
 * and disappears: the user sees no feedback when an action fails (e.g. a
 * POST /api/runs that returns 403). useToastSweeper handles auto-dismiss.
 *
 * Mounted as a sibling of the AppShell grid so it overlays the shell
 * without participating in the layout. Fixed-positioned bottom-right so
 * it doesn't fight the workspace modal (centered) or the titlebar.
 */
import { useUiStore, type Toast } from "../../state/ui-store.js";
import { cn } from "../../lib/cn.js";

const SEVERITY_CLASSES: Record<Toast["severity"], string> = {
  // Tokens via Tailwind utility names mapped in the project config; see
  // tokens.css for the underlying OKLCH values.
  info: "border-info bg-surface-1 text-text-primary",
  warn: "border-warning bg-warning-bg text-warning",
  error: "border-danger bg-danger-bg text-danger",
};

const SEVERITY_LABEL: Record<Toast["severity"], string> = {
  info: "Info",
  warn: "Warning",
  error: "Error",
};

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex flex-col items-center gap-2 px-4"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.severity === "error" ? "alert" : "status"}
          aria-live={toast.severity === "error" ? "assertive" : "polite"}
          className={cn(
            "pointer-events-auto flex max-w-2xl items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-lg",
            SEVERITY_CLASSES[toast.severity],
          )}
        >
          <span className="mono text-2xs uppercase opacity-70">
            {SEVERITY_LABEL[toast.severity]}
          </span>
          <span className="mono text-2xs text-text-tertiary">[{toast.scope}]</span>
          <span className="flex-1 whitespace-pre-wrap break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="ml-2 rounded-sm border border-transparent px-1 text-xs text-text-tertiary hover:border-border-subtle hover:text-text-primary"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
