import type { CanonicalRunEvent } from "../../state/run-store.js";

export interface SystemBannerProps {
  event: CanonicalRunEvent;
}

interface SystemPayload {
  model?: { id?: string };
  tools?: string[];
  mode?: "local" | "cloud";
  cwd?: string[];
  sandbox_enabled?: boolean;
}

export function SystemBanner({ event }: SystemBannerProps) {
  const p = (event.payload as SystemPayload | null) ?? {};
  const cwdLine = (p.cwd ?? []).join(", ");
  return (
    <div className="my-2 rounded-md border border-border-subtle bg-surface-1 px-2.5 py-2 text-sm text-text-secondary">
      <div className="mb-1 text-2xs font-semibold uppercase tracking-uppercase text-text-tertiary">
        system · {p.mode ?? "local"}
      </div>
      <div className="mono text-xs">
        model: {p.model?.id ?? "?"} · sandbox: {p.sandbox_enabled ? "on" : "off"} · tools:{" "}
        {(p.tools ?? []).length}
      </div>
      {cwdLine ? <div className="mono mt-0.5 text-xs text-text-tertiary">cwd: {cwdLine}</div> : null}
    </div>
  );
}
