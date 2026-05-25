import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { AgentsRepo } from "./agents.repo.js";
import { DocsRepo } from "./docs.repo.js";
import { EmbeddingsRepo } from "./embeddings.repo.js";
import { EventsRepo } from "./events.repo.js";
import { IndexStatusRepo } from "./index-status.repo.js";
import { McpServersRepo } from "./mcp-servers.repo.js";
import { ModelProvidersRepo } from "./model-providers.repo.js";
import { NotepadsRepo } from "./notepads.repo.js";
import { RunsRepo } from "./runs.repo.js";
import { SettingsRepo } from "./settings.repo.js";
import { SlashCommandsRepo } from "./slash-commands.repo.js";
import { SubagentDefinitionsRepo } from "./subagents.repo.js";
import { WorkspaceAllowlistRepo } from "./workspace-allowlist.repo.js";

export {
  AgentsRepo,
  DocsRepo,
  EmbeddingsRepo,
  EventsRepo,
  IndexStatusRepo,
  McpServersRepo,
  ModelProvidersRepo,
  NotepadsRepo,
  RunsRepo,
  SettingsRepo,
  SlashCommandsRepo,
  SubagentDefinitionsRepo,
  WorkspaceAllowlistRepo,
};

export interface Repositories {
  readonly agents: AgentsRepo;
  readonly docs: DocsRepo;
  readonly embeddings: EmbeddingsRepo;
  readonly indexStatus: IndexStatusRepo;
  readonly modelProviders: ModelProvidersRepo;
  readonly runs: RunsRepo;
  readonly events: EventsRepo;
  readonly settings: SettingsRepo;
  readonly mcpServers: McpServersRepo;
  readonly notepads: NotepadsRepo;
  readonly slashCommands: SlashCommandsRepo;
  readonly subagents: SubagentDefinitionsRepo;
  readonly workspaceAllowlist: WorkspaceAllowlistRepo;
}

export function createRepositories(raw: BetterSqlite3Database): Repositories {
  return {
    agents: new AgentsRepo(raw),
    docs: new DocsRepo(raw),
    embeddings: new EmbeddingsRepo(raw),
    indexStatus: new IndexStatusRepo(raw),
    modelProviders: new ModelProvidersRepo(raw),
    runs: new RunsRepo(raw),
    events: new EventsRepo(raw),
    settings: new SettingsRepo(raw),
    mcpServers: new McpServersRepo(raw),
    notepads: new NotepadsRepo(raw),
    slashCommands: new SlashCommandsRepo(raw),
    subagents: new SubagentDefinitionsRepo(raw),
    workspaceAllowlist: new WorkspaceAllowlistRepo(raw),
  };
}
