import type { FastifyInstance } from "fastify";
import { registerAgentsRoutes, type AgentsRoutesDeps } from "./agents.routes.js";
import { registerEventsRoutes, type EventsRoutesDeps } from "./events.routes.js";
import { registerHealthRoutes } from "./health.js";
import { registerRunsRoutes, type RunsRoutesDeps } from "./runs.routes.js";
import {
  registerSecurityRoutes,
  type SecurityRoutesDeps,
} from "./security.routes.js";
import {
  registerSettingsRoutes,
  type SettingsRoutesDeps,
} from "./settings.routes.js";
import { registerUsageRoutes, type UsageRoutesDeps } from "./usage.routes.js";
import {
  registerWorkspaceAllowlistRoutes,
  type WorkspaceAllowlistRoutesDeps,
} from "./workspace-allowlist.routes.js";

export interface RouteDeps {
  security: SecurityRoutesDeps;
  settings: SettingsRoutesDeps;
  workspaceAllowlist: WorkspaceAllowlistRoutesDeps;
  agents: AgentsRoutesDeps;
  runs: RunsRoutesDeps;
  events: EventsRoutesDeps;
  usage: UsageRoutesDeps;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  await registerHealthRoutes(app);
  await registerSecurityRoutes(app, deps.security);
  await registerSettingsRoutes(app, deps.settings);
  await registerWorkspaceAllowlistRoutes(app, deps.workspaceAllowlist);
  await registerAgentsRoutes(app, deps.agents);
  await registerRunsRoutes(app, deps.runs);
  await registerEventsRoutes(app, deps.events);
  await registerUsageRoutes(app, deps.usage);
}
