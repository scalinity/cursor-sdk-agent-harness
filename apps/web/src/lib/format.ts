const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

const integer = new Intl.NumberFormat("en-US");

export function formatMicros(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return "--";
  return usdCompact.format(micros / 1_000_000);
}

export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) return "--";
  return integer.format(tokens);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function tokenTotal(input: number | null, output: number | null): number | null {
  if (input === null && output === null) return null;
  return (input ?? 0) + (output ?? 0);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "--";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours === 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${hours}h ${String(restMinutes).padStart(2, "0")}m`;
}

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "--";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "--";
  const diffSeconds = Math.round((time - now) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  return rtf.format(Math.round(diffSeconds / 86400), "day");
}

export function isoDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateRangeForPreset(preset: "24h" | "7d" | "30d", now = new Date()): { from: Date; to: Date } {
  const to = now;
  const from = new Date(to);
  if (preset === "24h") from.setDate(from.getDate() - 1);
  else if (preset === "7d") from.setDate(from.getDate() - 7);
  else from.setDate(from.getDate() - 30);
  return { from, to };
}
