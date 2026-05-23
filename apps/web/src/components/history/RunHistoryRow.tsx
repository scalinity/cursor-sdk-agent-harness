import { Link } from "react-router-dom";
import type { RunSummary } from "@harness/shared";
import { formatDuration, formatMicros, formatRelativeTime, formatTokens, tokenTotal } from "../../lib/format.js";
import { RunStatusPill } from "../streaming/RunStatusPill.js";

export interface RunHistoryRowProps {
  run: RunSummary;
  selected: boolean;
  onToggleSelected: (runId: string) => void;
  onFilterAgent: (agentId: string) => void;
}

function costText(run: RunSummary): string {
  if (run.usageSource === "unavailable") return "--";
  return formatMicros(run.costUsdMicros);
}

export function RunHistoryRow({ run, selected, onToggleSelected, onFilterAgent }: RunHistoryRowProps) {
  const tokens = run.usageSource === "unavailable" ? null : tokenTotal(run.inputTokens, run.outputTokens);
  const title = run.promptPreview.length > 80 ? `${run.promptPreview.slice(0, 80)}...` : run.promptPreview;
  return (
    <tr className="border-t border-border-subtle hover:bg-surface-2">
      <td className="p-2">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelected(run.id)} aria-label={`Select ${run.id}`} />
      </td>
      <td className="p-2"><RunStatusPill runId={run.id} status={run.status} /></td>
      <td className="p-2 text-text-primary">
        <Link className="hover:text-accent-primary" to={`/runs/${run.id}/replay`} title={run.promptPreview}>
          {title || run.id}
        </Link>
      </td>
      <td className="p-2">
        <button className="text-text-secondary hover:text-accent-primary" type="button" onClick={() => onFilterAgent(run.agentId)}>
          {run.agentName ?? run.agentId}
        </button>
      </td>
      <td className="mono p-2 text-text-secondary">{run.modelId ?? "--"}</td>
      <td className="p-2 text-text-secondary" title={run.startedAt}>{formatRelativeTime(run.startedAt)}</td>
      <td className="mono p-2 text-text-secondary">{formatDuration(run.durationMs)}</td>
      <td className="mono p-2 text-text-secondary">
        {formatTokens(run.toolCallCount)}
        {run.errorToolCallCount > 0 ? <span className="ml-2 rounded-sm bg-danger-bg px-1 text-danger">{run.errorToolCallCount}</span> : null}
      </td>
      <td className="mono p-2 text-text-secondary">{costText(run)}</td>
      <td className="mono p-2 text-text-secondary">{formatTokens(tokens)}</td>
    </tr>
  );
}
