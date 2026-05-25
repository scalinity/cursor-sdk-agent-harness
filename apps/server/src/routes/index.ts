import type { FastifyInstance } from "fastify";
import { registerAgentsRoutes, type AgentsRoutesDeps } from "./agents.routes.js";
import {
  registerCommandsRoutes,
  type CommandsRoutesDeps,
} from "./commands.routes.js";
import {
  registerDocsRoutes,
  type DocsRoutesDeps,
} from "./docs.routes.js";
import { registerEventsRoutes, type EventsRoutesDeps } from "./events.routes.js";
import { registerFilesRoutes, type FilesRoutesDeps } from "./files.routes.js";
import { registerGitRoutes, type GitRoutesDeps } from "./git.routes.js";
import { registerHealthRoutes } from "./health.js";
import {
  registerMcpServersRoutes,
  type McpServersRoutesDeps,
} from "./mcp-servers.routes.js";
import {
  registerNotepadsRoutes,
  type NotepadsRoutesDeps,
} from "./notepads.routes.js";
import {
  registerObservabilityRoutes,
  type ObservabilityRoutesDeps,
} from "./observability.routes.js";
import { registerRunsRoutes, type RunsRoutesDeps } from "./runs.routes.js";
import {
  registerSecurityRoutes,
  type SecurityRoutesDeps,
} from "./security.routes.js";
import {
  registerSettingsRoutes,
  type SettingsRoutesDeps,
} from "./settings.routes.js";
import {
  registerSubagentsRoutes,
  type SubagentsRoutesDeps,
} from "./subagents.routes.js";
import {
  registerTerminalAiRoutes,
  type TerminalAiRoutesDeps,
} from "./terminal-ai.routes.js";
import { registerUsageRoutes, type UsageRoutesDeps } from "./usage.routes.js";
import {
  registerWorkspaceAllowlistRoutes,
  type WorkspaceAllowlistRoutesDeps,
} from "./workspace-allowlist.routes.js";
import {
  registerContextRoutes,
  type ContextRoutesDeps,
} from "./context.routes.js";
import {
  registerSearchRoutes,
  type SearchRoutesDeps,
} from "./search.routes.js";
import {
  registerRulesRoutes,
  type RulesRoutesDeps,
} from "./rules.routes.js";
import {
  registerProvidersRoutes,
  type ProvidersRoutesDeps,
} from "./providers.routes.js";

export interface RouteDeps {
  security: SecurityRoutesDeps;
  settings: SettingsRoutesDeps;
  workspaceAllowlist: WorkspaceAllowlistRoutesDeps;
  agents: AgentsRoutesDeps;
  runs: RunsRoutesDeps;
  events: EventsRoutesDeps;
  usage: UsageRoutesDeps;
  mcpServers: McpServersRoutesDeps;
  subagents: SubagentsRoutesDeps;
  observability: ObservabilityRoutesDeps;
  git: GitRoutesDeps;
  files: FilesRoutesDeps;
  context: ContextRoutesDeps;
  search: SearchRoutesDeps;
  rules: RulesRoutesDeps;
  docs: DocsRoutesDeps;
  notepads: NotepadsRoutesDeps;
  commands: CommandsRoutesDeps;
  terminalAi: TerminalAiRoutesDeps;
  providers: ProvidersRoutesDeps;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  await registerHealthRoutes(app);
  await registerSecurityRoutes(app, deps.security);
  await registerSettingsRoutes(app, deps.settings);
  await registerWorkspaceAllowlistRoutes(app, deps.workspaceAllowlist);
  await registerMcpServersRoutes(app, deps.mcpServers);
  await registerSubagentsRoutes(app, deps.subagents);
  await registerAgentsRoutes(app, deps.agents);
  await registerRunsRoutes(app, deps.runs);
  await registerEventsRoutes(app, deps.events);
  await registerUsageRoutes(app, deps.usage);
  await registerObservabilityRoutes(app, deps.observability);
  await registerGitRoutes(app, deps.git);
  await registerFilesRoutes(app, deps.files);
  await registerContextRoutes(app, deps.context);
  await registerSearchRoutes(app, deps.search);
  await registerRulesRoutes(app, deps.rules);
  await registerDocsRoutes(app, deps.docs);
  await registerNotepadsRoutes(app, deps.notepads);
  await registerCommandsRoutes(app, deps.commands);
  await registerTerminalAiRoutes(app, deps.terminalAi);
  await registerProvidersRoutes(app, deps.providers);
}
