import type { ConnectionState } from "../../state/ui-store.js";
import { cn } from "../../lib/cn.js";

export interface ConnectionBannerProps {
  connectionState: ConnectionState;
  onRetry?: () => void;
}

export function ConnectionBanner({ connectionState, onRetry }: ConnectionBannerProps) {
  if (connectionState === "open" || connectionState === "idle") return null;
  const isError = connectionState === "error" || connectionState === "closed";
  return (
    <div
      className={cn(
        "connection-banner",
        isError ? "connection-banner--err" : "connection-banner--warn",
      )}
    >
      <span>
        {connectionState === "connecting" ? "Connecting…" : null}
        {connectionState === "reconnecting" ? "Reconnecting…" : null}
        {connectionState === "closed" ? "Connection lost." : null}
        {connectionState === "error" ? "Connection error — manual retry required." : null}
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto inline-flex h-control-sm items-center rounded-sm border border-border-subtle bg-surface-2 px-2 text-xs text-text-secondary"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
