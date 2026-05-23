import type { SdkRunStatus } from "@harness/shared";
import { cn } from "../../lib/cn.js";
import { useRunStore } from "../../state/run-store.js";
import { CostBadge } from "./CostBadge.js";

export interface RunStatusPillProps {
  runId: string | null;
  status?: SdkRunStatus | null;
}

const STATUS_CLASS: Record<SdkRunStatus, string> = {
  CREATING: "text-text-tertiary",
  RUNNING: "text-accent-primary run-status-pill--running",
  FINISHED: "text-success",
  ERROR: "text-danger",
  CANCELLED: "text-text-tertiary",
  EXPIRED: "text-text-tertiary",
};

export function RunStatusPill({ runId, status }: RunStatusPillProps) {
  const runStatus = useRunStore((s) => (runId ? s.byId[runId]?.status : null));
  const resolved = status ?? runStatus ?? "CREATING";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "run-status-pill mono inline-flex h-control-sm items-center rounded-sm border border-border-subtle bg-surface-1 px-2 text-xs",
          STATUS_CLASS[resolved],
        )}
      >
        <span className="run-status-pill__dot" aria-hidden="true" />
        {resolved}
      </span>
      <CostBadge runId={runId} />
    </span>
  );
}
