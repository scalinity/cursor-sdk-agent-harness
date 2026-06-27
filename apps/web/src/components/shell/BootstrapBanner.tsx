/**
 * BootstrapBanner — surfaces fatal bootstrap failures (CSRF fetch errored
 * AND no token is held). Without this, the user sees an empty shell with
 * no actionable feedback when /api/security/csrf-token returns 5xx at first
 * paint. The banner offers a manual retry that calls `useCsrfToken.refresh`.
 */
export interface BootstrapBannerProps {
  error: string;
  loading: boolean;
  onRetry: () => void;
}

export function BootstrapBanner({ error, loading, onRetry }: BootstrapBannerProps) {
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center gap-3 border-b border-danger bg-danger-bg px-4 py-2 text-sm text-text-primary"
      role="alert"
    >
      <span className="font-semibold text-danger">Bootstrap failed</span>
      <span className="min-w-0 truncate text-text-secondary">{error}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={loading}
        className="ml-auto inline-flex h-control-sm items-center rounded-sm border border-border-subtle bg-surface-2 px-2 text-xs text-text-secondary disabled:opacity-50"
      >
        {loading ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
