import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { AgentsRepo } from "./agents.repo.js";
import { EventsRepo } from "./events.repo.js";
import { McpServersRepo } from "./mcp-servers.repo.js";
import { RunsRepo } from "./runs.repo.js";
import { SettingsRepo } from "./settings.repo.js";
import { SubagentDefinitionsRepo } from "./subagents.repo.js";
import { WorkspaceAllowlistRepo } from "./workspace-allowlist.repo.js";

export {
  AgentsRepo,
  EventsRepo,
  McpServersRepo,
  RunsRepo,
  SettingsRepo,
  SubagentDefinitionsRepo,
  WorkspaceAllowlistRepo,
};

export interface Repositories {
  readonly agents: AgentsRepo;
  readonly runs: RunsRepo;
  readonly events: EventsRepo;
  readonly settings: SettingsRepo;
  readonly mcpServers: McpServersRepo;
  readonly subagents: SubagentDefinitionsRepo;
  readonly workspaceAllowlist: WorkspaceAllowlistRepo;
}

export function createRepositories(raw: BetterSqlite3Database): Repositories {
  return {
    agents: new AgentsRepo(raw),
    runs: new RunsRepo(raw),
    events: new EventsRepo(raw),
    settings: new SettingsRepo(raw),
    mcpServers: new McpServersRepo(raw),
    subagents: new SubagentDefinitionsRepo(raw),
    workspaceAllowlist: new WorkspaceAllowlistRepo(raw),
  };
}
