/**
 * Programmatic Fastify entrypoint. Used by the Electron main process so the
 * server can boot in-process under the same Node runtime that owns Keychain,
 * SQLite, and CSRF secrets. The CLI entry (`index.ts`) is a thin wrapper that
 * calls this and then process.exit's on fatal error.
 */
import { buildApp, type BuiltApp } from "./app.js";
import { loadEnv, type Env } from "./config/env.js";
import { openDb } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import { assertBindAllowed } from "./security/bind-policy.js";
import { ensureDefaultWorkspace } from "./security/default-workspace.js";

export interface StartServerOptions {
  /**
   * Override env vars before they reach loadEnv. Useful for the Electron main
   * process which wants to flip HARNESS_DESKTOP=1 without polluting the host
   * shell.
   */
  envOverrides?: NodeJS.ProcessEnv;
}

export interface StartedServer {
  built: BuiltApp;
  env: Env;
  port: number;
  /** Resolved URL the renderer should hit, e.g. `http://127.0.0.1:4783`. */
  url: string;
  close: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<StartedServer> {
  const merged = { ...process.env, ...options.envOverrides };
  const env = loadEnv(merged);
  assertBindAllowed(env.HOST, env.ALLOW_REMOTE_BIND);

  const dbClient = openDb({ filePath: env.DB_PATH });
  dbClient.verifyMigrations();
  const repos = createRepositories(dbClient.raw);

  // Cursor-style zero-setup default: ensure a workspace is active (falling back
  // to the user's home dir) before the renderer connects, so the coding agent
  // can provision and the model works without the user picking a folder first.
  await ensureDefaultWorkspace({
    allowlist: repos.workspaceAllowlist,
    settings: repos.settings,
  });

  const built = await buildApp({ env, repos });
  await built.app.listen({ host: env.HOST, port: env.PORT });

  built.app.log.info(
    { host: env.HOST, port: env.PORT, webOrigin: env.WEB_ORIGIN },
    "cursor-sdk-agent-harness server listening",
  );

  return {
    built,
    env,
    port: env.PORT,
    url: `http://${env.HOST}:${env.PORT}`,
    close: async () => {
      await built.app.close();
      dbClient.raw.close();
    },
  };
}

// Phase 18 browser MCP seam — re-exported so the Electron main process can
// register its BrowserController and start the loopback MCP server via the
// same dynamic `import("@harness/server/dist/programmatic.js")` path.
export {
  registerBrowserBackend,
  startBrowserMcpServer,
  BROWSER_MCP_SERVER_NAME,
} from "./mcp/built-in/browser-mcp/index.js";
export type {
  BrowserBackend,
  BrowserMcpServer,
} from "./mcp/built-in/browser-mcp/index.js";
