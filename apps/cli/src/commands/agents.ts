import type { AgentSummary } from "@harness/shared";
import { writeJsonLine } from "../output/json.js";
import { formatMicros, renderTable, shortId } from "../output/table.js";
import type { CliMode, CommandDeps } from "../types.js";

export interface AgentsListOptions {
  json?: boolean;
}

export async function listAgents(options: AgentsListOptions, deps: Pick<CommandDeps, "http" | "write">): Promise<void> {
  const result = await deps.http.listAgents({ limit: 500 });
  if (options.json) {
    for (const agent of result.items) writeJsonLine(deps.write, { type: "agent", agent });
    return;
  }
  deps.write(renderTable(result.items, [
    { key: "id", header: "ID", value: (agent) => shortId(agent.id) },
    { key: "name", header: "Name", value: (agent) => agent.name, maxWidth: 28 },
    { key: "model", header: "Model", value: (agent) => agent.modelId, maxWidth: 24 },
    { key: "mode", header: "Mode", value: (agent) => agent.executionMode },
    { key: "last", header: "Last Active", value: (agent) => agent.lastActiveAt ?? "n/a", maxWidth: 20 },
    { key: "runs", header: "Runs", value: (agent) => String(agent.runCount) },
    { key: "cost", header: "Total Cost", value: (agent) => formatMicros(agent.totalCostUsdMicros) },
  ]));
}

export interface AgentCreateOptions {
  name: string;
  model?: string;
  mode?: CliMode;
  workspace?: string;
  json?: boolean;
}

export async function createAgent(options: AgentCreateOptions, deps: Pick<CommandDeps, "http" | "write">): Promise<AgentSummary> {
  await deps.http.ensureCsrfToken();
  const agent = await deps.http.createAgent({
    name: options.name,
    modelId: options.model ?? "composer-2-5-fast",
    mode: "local",
    cwd: [options.workspace ?? process.cwd()],
  }) as AgentSummary;
  if (options.json) writeJsonLine(deps.write, { type: "agent_created", agent });
  else deps.write(renderTable([agent], [
    { key: "id", header: "ID", value: (row) => shortId(row.id) },
    { key: "name", header: "Name", value: (row) => row.name },
    { key: "model", header: "Model", value: (row) => row.modelId },
    { key: "mode", header: "Mode", value: (row) => row.executionMode },
  ]));
  return agent;
}
