import { HarnessHttpClient } from "./client/http.js";
import { HarnessWsClient } from "./client/ws.js";
import { resolveExplicitServerUrl, resolveWebOrigin } from "./config.js";
import type { CliHttpPort, CliStreamPort } from "./types.js";

export interface BackendOptions {
  server?: string;
  origin?: string;
}

export interface CliBackend {
  http: CliHttpPort;
  origin: string;
  /** True when the server is running in-process, false when attached to an external one. */
  embedded: boolean;
  createStream(csrfToken: string): CliStreamPort;
  /** Closes the embedded server (no-op for an external one). Always safe to call. */
  dispose(): Promise<void>;
}

// Structural shape of the dynamically-imported server bootstrap. Declared here
// (rather than imported from @harness/server) so the CLI typecheck never
// depends on apps/server having a built dist/.
type StartServerFn = (options?: {
  envOverrides?: NodeJS.ProcessEnv;
  listenPort?: number;
}) => Promise<{ url: string; close: () => Promise<void> }>;

/**
 * Resolves the backend the CLI talks to. When the user explicitly points at an
 * external server (`--server` / `HARNESS_SERVER_URL`) we connect to it; otherwise
 * we boot the full server in-process so `harness` works with zero setup.
 */
export async function resolveCliBackend(options: BackendOptions): Promise<CliBackend> {
  const origin = resolveWebOrigin(options.origin);
  const explicit = resolveExplicitServerUrl(options.server);

  if (explicit) {
    const http = new HarnessHttpClient({ serverUrl: explicit, origin });
    return {
      http,
      origin,
      embedded: false,
      createStream: (csrfToken) => new HarnessWsClient({ serverUrl: explicit, csrfToken, origin }),
      dispose: async () => {},
    };
  }

  const server = await startEmbeddedServer(origin);
  const http = new HarnessHttpClient({ serverUrl: server.url, origin });
  return {
    http,
    origin,
    embedded: true,
    createStream: (csrfToken) => new HarnessWsClient({ serverUrl: server.url, csrfToken, origin }),
    dispose: server.close,
  };
}

async function startEmbeddedServer(origin: string): Promise<{ url: string; close: () => Promise<void> }> {
  // Variable specifier keeps this a runtime-only import: TypeScript leaves it as
  // a dynamic `Promise<any>` instead of resolving @harness/server's built dist
  // at compile time. Node resolves it through the workspace symlink at runtime.
  const specifier = "@harness/server/dist/programmatic.js";
  const mod = (await import(specifier)) as { startServer: StartServerFn };
  return mod.startServer({
    listenPort: 0,
    envOverrides: {
      // Pino would otherwise stream JSON logs to stdout and shred the fullscreen
      // TUI. Run-level failures still surface to the user as error frames.
      LOG_LEVEL: "silent",
      // Keep the server's allowed Origin aligned with the header the WS client
      // sends, so the loopback upgrade passes the origin policy even when the
      // user overrides --origin.
      WEB_ORIGIN: origin,
    },
  });
}
