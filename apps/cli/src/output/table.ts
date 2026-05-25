import { sanitizeTerminalText } from "./sanitize.js";

export interface TableColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string;
  maxWidth?: number;
}

function truncate(value: string, maxWidth: number | undefined): string {
  if (!maxWidth || value.length <= maxWidth) return value;
  if (maxWidth <= 1) return "…";
  return `${value.slice(0, maxWidth - 1)}…`;
}

export function renderTable<T>(rows: readonly T[], columns: readonly TableColumn<T>[]): string {
  const rendered = rows.map((row) => columns.map((column) => truncate(sanitizeTerminalText(column.value(row)), column.maxWidth)));
  const widths = columns.map((column, index) => {
    const values = rendered.map((row) => row[index] ?? "");
    return Math.max(sanitizeTerminalText(column.header).length, ...values.map((value) => value.length));
  });
  const header = columns.map((column, index) => sanitizeTerminalText(column.header).padEnd(widths[index] ?? 0)).join("  ");
  const divider = widths.map((width) => "─".repeat(width)).join("  ");
  const body = rendered.map((row) => row.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  "));
  return [header, divider, ...body].join("\n");
}

export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : id.slice(0, length);
}

export function formatMicros(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value === 0 ? 2 : 4,
    maximumFractionDigits: 4,
  }).format(value / 1_000_000);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function firstLine(value: string, maxWidth = 80): string {
  return truncate(value.split(/\r?\n/, 1)[0] ?? "", maxWidth);
}
