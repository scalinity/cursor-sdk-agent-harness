import type { McpValidationStatus } from "@harness/shared";

const LABEL: Record<McpValidationStatus, string> = {
  unknown: "Unknown",
  valid: "Valid",
  invalid: "Invalid",
  unreachable: "Unreachable",
};

// Token utilities — every color/background/border resolves to a CSS
// variable from tokens.css. No hardcoded visuals (Phase 0.5 contract).
const CLASS: Record<McpValidationStatus, string> = {
  unknown: "border-border-subtle bg-surface-2 text-text-tertiary",
  valid: "border-success/40 bg-success-bg text-success",
  invalid: "border-danger/40 bg-danger-bg text-danger",
  unreachable: "border-warning/40 bg-warning-bg text-warning",
};

export interface StatusBadgeProps {
  status: McpValidationStatus;
  title?: string;
}

/**
 * Status pill for MCP server validation state. Renders the four statuses
 * (`unknown`, `valid`, `invalid`, `unreachable`) with token-backed colors.
 * Spec §5 MCP Server CRUD.
 */
export function StatusBadge({ status, title }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex h-control-sm items-center rounded-sm border px-2 text-xs font-medium ${CLASS[status]}`}
      title={title ?? LABEL[status]}
    >
      {LABEL[status]}
    </span>
  );
}
