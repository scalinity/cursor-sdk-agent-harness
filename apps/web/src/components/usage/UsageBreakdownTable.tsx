import { useState } from "react";
import type { UsageBreakdownRow } from "@harness/shared";
import { formatMicros, formatTokens } from "../../lib/format.js";

export function UsageBreakdownTable({
  byModel,
  byAgent,
}: {
  byModel: UsageBreakdownRow[];
  byAgent: UsageBreakdownRow[];
}) {
  const [tab, setTab] = useState<"model" | "agent">("model");
  const rows = tab === "model" ? byModel : byAgent;
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  return (
    <div className="border border-border-subtle bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border-subtle p-2">
        <button
          className={tab === "model" ? "h-control-md rounded-sm bg-accent-bg px-3 text-sm text-accent-primary" : "h-control-md rounded-sm px-3 text-sm text-text-tertiary"}
          type="button"
          onClick={() => setTab("model")}
        >
          By model
        </button>
        <button
          className={tab === "agent" ? "h-control-md rounded-sm bg-accent-bg px-3 text-sm text-accent-primary" : "h-control-md rounded-sm px-3 text-sm text-text-tertiary"}
          type="button"
          onClick={() => setTab("agent")}
        >
          By agent
        </button>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="text-left text-xs uppercase tracking-uppercase text-text-tertiary">
          <tr>
            <th className="p-2 font-medium">Name</th>
            <th className="p-2 font-medium">Runs</th>
            <th className="p-2 font-medium">Tokens</th>
            <th className="p-2 font-medium">Cost</th>
            <th className="p-2 font-medium">Avg</th>
            <th className="p-2 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const share = totalCost > 0 ? Math.round((row.cost / totalCost) * 100) : 0;
            const avg = row.runs > 0 ? Math.round(row.cost / row.runs) : 0;
            return (
              <tr key={row.id} className="border-t border-border-subtle">
                <td className="p-2 text-text-primary">{row.name}</td>
                <td className="mono p-2 text-text-secondary">{formatTokens(row.runs)}</td>
                <td className="mono p-2 text-text-secondary">{formatTokens(row.tokens)}</td>
                <td className="mono p-2 text-text-secondary">{formatMicros(row.cost)}</td>
                <td className="mono p-2 text-text-secondary">{formatMicros(avg)}</td>
                <td className="mono p-2 text-text-secondary">{share}%</td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td className="p-4 text-sm text-text-tertiary" colSpan={6}>No usage recorded yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
