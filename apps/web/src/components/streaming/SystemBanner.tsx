import { z } from "zod";
import type { CanonicalRunEvent } from "../../state/run-store.js";
import { useSettingsStore } from "../../state/settings-store.js";
import { safePayload } from "../../lib/safe-payload.js";

const systemPayloadSchema = z
  .object({
    model: z.object({ id: z.string().optional() }).optional(),
    tools: z.array(z.string()).optional(),
    mode: z.enum(["local", "cloud"]).optional(),
    cwd: z.array(z.string()).optional(),
    sandbox_enabled: z.boolean().optional(),
  })
  .nullable();

export interface SystemBannerProps {
  event: CanonicalRunEvent;
}

function isPricingStale(value: string | null | undefined): boolean {
  if (!value) return true;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > 30 * 24 * 60 * 60 * 1000;
}

export function SystemBanner({ event }: SystemBannerProps) {
  const payload = safePayload(event.payload, systemPayloadSchema) ?? {};
  const lastVerifiedAt = useSettingsStore((s) => s.snapshot?.pricing.lastVerifiedAt ?? null);
  const stale = isPricingStale(lastVerifiedAt);
  const tools = payload.tools ?? [];
  const cwd = payload.cwd ?? [];
  const sandboxLabel =
    payload.sandbox_enabled === undefined
      ? "sandbox unknown"
      : payload.sandbox_enabled
        ? "sandbox on"
        : "sandbox off";

  return (
    <div className="system-banner">
      <div className="system-banner__head">
        <span className="mono">system.init</span>
        <span className="system-banner__mode">{payload.mode ?? "local"}</span>
        <span>{sandboxLabel}</span>
      </div>
      <div className="system-banner__meta mono">
        <span>model {payload.model?.id ?? "unknown"}</span>
        <span>tools {tools.length}</span>
        {cwd.length > 0 ? <span>cwd {cwd.join(", ")}</span> : null}
      </div>
      {tools.length > 0 ? <div className="system-banner__tools mono">{tools.join(" · ")}</div> : null}
      {stale ? <div className="system-banner__warn">Pricing freshness needs verification.</div> : null}
    </div>
  );
}
