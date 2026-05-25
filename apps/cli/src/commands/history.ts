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
  const rows = runRowsFromUnknown(result.items);
  if (options.json) {
    for (const run of rows) writeJsonLine(deps.write, { type: "run", run });
    return;
  }
  deps.write(renderTable(rows, [
    { key: "id", header: "Run ID", value: (run) => shortId(run.id) },
    { key: "agent", header: "Agent", value: (run) => run.agentName ?? run.agentId, maxWidth: 18 },
    { key: "mode", header: "Mode", value: (run) => run.executionMode ?? "n/a" },
    { key: "status", header: "Status", value: (run) => run.status },
    { key: "cost", header: "Cost", value: (run) => formatMicros(run.costUsdMicros) },
    { key: "duration", header: "Duration", value: (run) => formatDuration(run.durationMs) },
    { key: "prompt", header: "Prompt", value: (run) => firstLine(run.promptPreview, 40) },
  ]));
}

interface HistoryRunRow {
  id: string;
  agentId: string;
  agentName: string | null;
  executionMode: string | null;
  status: string;
  costUsdMicros: number | null;
  durationMs: number | null;
  promptPreview: string;
}

function runRowsFromUnknown(items: unknown[]): HistoryRunRow[] {
  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.agentId !== "string" || typeof record.status !== "string") return [];
    return [{
      id: record.id,
      agentId: record.agentId,
      agentName: typeof record.agentName === "string" ? record.agentName : null,
      executionMode: typeof record.executionMode === "string" ? record.executionMode : null,
      status: record.status,
      costUsdMicros: typeof record.costUsdMicros === "number" ? record.costUsdMicros : null,
      durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
      promptPreview: typeof record.promptPreview === "string" ? record.promptPreview : "",
    }];
  });
}
