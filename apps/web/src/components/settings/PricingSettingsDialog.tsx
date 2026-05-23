import { useState } from "react";
import type { SettingsSnapshot, UpdatePricingRequest } from "@harness/shared";
import { useSettings } from "../../hooks/useSettings.js";

export interface PricingSettingsDialogProps {
  open: boolean;
  snapshot: SettingsSnapshot | null;
  onClose: () => void;
  onSaved?: () => void;
}

type RateKey =
  | "fastInput"
  | "fastOutput"
  | "fastCached"
  | "standardInput"
  | "standardOutput"
  | "standardCached";

type FormState = Record<RateKey, string> & { promoMultiplier: string };

function microsToInput(value: number): string {
  return (value / 1_000_000).toString();
}

function inputToMicros(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 1_000_000);
}

function initialState(snapshot: SettingsSnapshot | null): FormState {
  return {
    fastInput: microsToInput(snapshot?.pricing.composer25Fast.inputPerMillionUsdMicros ?? 0),
    fastOutput: microsToInput(snapshot?.pricing.composer25Fast.outputPerMillionUsdMicros ?? 0),
    fastCached: microsToInput(snapshot?.pricing.composer25Fast.cachedInputPerMillionUsdMicros ?? 0),
    standardInput: microsToInput(snapshot?.pricing.composer25.inputPerMillionUsdMicros ?? 0),
    standardOutput: microsToInput(snapshot?.pricing.composer25.outputPerMillionUsdMicros ?? 0),
    standardCached: microsToInput(snapshot?.pricing.composer25.cachedInputPerMillionUsdMicros ?? 0),
    promoMultiplier: String(snapshot?.pricing.promoMultiplier ?? 1),
  };
}

function lastVerified(snapshot: SettingsSnapshot | null): string {
  return snapshot?.pricing.lastVerifiedAt ?? "never";
}

export function PricingSettingsDialog({ open, snapshot, onClose, onSaved }: PricingSettingsDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(snapshot));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { updatePricing } = useSettings();

  if (!open) return null;

  const settingsReady = snapshot !== null;
  const setField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const parsedPromo = Number(form.promoMultiplier);
    const promoMultiplier = Number.isFinite(parsedPromo)
      ? Math.min(1, Math.max(0, parsedPromo))
      : 1;
    const patch: UpdatePricingRequest = {
      composer25Fast: {
        inputPerMillionUsdMicros: inputToMicros(form.fastInput),
        outputPerMillionUsdMicros: inputToMicros(form.fastOutput),
        cachedInputPerMillionUsdMicros: inputToMicros(form.fastCached),
      },
      composer25: {
        inputPerMillionUsdMicros: inputToMicros(form.standardInput),
        outputPerMillionUsdMicros: inputToMicros(form.standardOutput),
        cachedInputPerMillionUsdMicros: inputToMicros(form.standardCached),
      },
      promoMultiplier,
      markVerified: true,
    };
    try {
      await updatePricing(patch);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pricing save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-text-primary">
      <div className="w-full max-w-xl rounded-md border border-border-strong bg-surface-1 p-4 shadow-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Pricing</h2>
            <p className="mt-1 text-sm text-text-tertiary">Last verified: {lastVerified(snapshot)}</p>
          </div>
          <button className="mono text-xs text-text-tertiary hover:text-text-primary" type="button" onClick={onClose}>
            close
          </button>
        </div>
        {error ? <div className="mb-3 border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="border border-border-subtle p-3" disabled={!settingsReady}>
            <legend className="px-1 text-sm font-semibold">Composer 2.5 Fast</legend>
            <RateInput label="Input" value={form.fastInput} onChange={(value) => setField("fastInput", value)} />
            <RateInput label="Output" value={form.fastOutput} onChange={(value) => setField("fastOutput", value)} />
            <RateInput label="Cached" value={form.fastCached} onChange={(value) => setField("fastCached", value)} />
          </fieldset>
          <fieldset className="border border-border-subtle p-3" disabled={!settingsReady}>
            <legend className="px-1 text-sm font-semibold">Composer 2.5 Standard</legend>
            <RateInput label="Input" value={form.standardInput} onChange={(value) => setField("standardInput", value)} />
            <RateInput label="Output" value={form.standardOutput} onChange={(value) => setField("standardOutput", value)} />
            <RateInput label="Cached" value={form.standardCached} onChange={(value) => setField("standardCached", value)} />
          </fieldset>
        </div>
        <label className="mt-3 flex flex-col gap-1 text-sm text-text-secondary">
          Promo multiplier
          <input
            className="h-control-lg rounded-sm border border-border-subtle bg-surface-2 px-2 text-text-primary"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={form.promoMultiplier}
            onChange={(event) => setField("promoMultiplier", event.currentTarget.value)}
          />
          <span className="text-xs text-text-tertiary">Use 0.1 during a 90% promo</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="h-control-md rounded-sm bg-accent-primary px-3 text-sm font-semibold text-text-inverse" type="button" onClick={() => void save()} disabled={saving || !settingsReady}>
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RateInput(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-2 flex flex-col gap-1 text-sm text-text-secondary">
      {props.label} USD per million
      <input
        className="h-control-lg rounded-sm border border-border-subtle bg-surface-2 px-2 text-text-primary"
        type="number"
        min="0"
        step="0.000001"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </label>
  );
}
