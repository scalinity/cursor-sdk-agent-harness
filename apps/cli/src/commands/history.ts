import { writeJsonLine } from "../output/json.js";
import { firstLine, formatDuration, formatMicros, renderTable, shortId } from "../output/table.js";
import type { CommandDeps } from "../types.js";

export interface HistoryCommandOptions {
  agent?: string;
  limit?: number;
  json?: boolean;
}

export async function showHistory(options: HistoryCommandOptions, deps: Pick<CommandDeps, "http" | "write">): Promise<void> {
  const query: Record<string, string | number | boolean | undefined> = { limit: options.limit ?? 20 };
  if (options.agent) query.agentId = options.agent;
  const result = await deps.http.listRuns(query);
  if (options.json) {
    for (const run of result.items) writeJsonLine(deps.write, { type: "run", run });
    return;
  }
  deps.write(renderTable(result.items, [
    { key: "id", header: "Run ID", value: (run) => shortId(run.id) },
    { key: "agent", header: "Agent", value: (run) => run.agentName ?? run.agentId, maxWidth: 18 },
    { key: "mode", header: "Mode", value: (run) => run.executionMode ?? "n/a" },
    { key: "status", header: "Status", value: (run) => run.status },
    { key: "cost", header: "Cost", value: (run) => formatMicros(run.costUsdMicros) },
    { key: "duration", header: "Duration", value: (run) => formatDuration(run.durationMs) },
    { key: "prompt", header: "Prompt", value: (run) => firstLine(run.promptPreview, 40) },
  ]));
}
