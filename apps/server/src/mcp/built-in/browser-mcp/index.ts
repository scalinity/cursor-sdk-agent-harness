import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerBrowserTools } from "./tools.js";

export {
  registerBrowserBackend,
  getBrowserBackend,
  hasBrowserBackend,
  BrowserBackendUnavailableError,
} from "./backend.js";
export type { BrowserBackend, BrowserWaitForInput } from "./backend.js";

/** The built-in browser MCP server name, as registered in `Agent.create` options. */
export const BROWSER_MCP_SERVER_NAME = "harness_browser";

export interface BrowserMcpServer {
  /** Base loopback URL, e.g. http://127.0.0.1:54321. */
  baseUrl: string;
  /** Per-agent MCP endpoint url to register in `Agent.create` options. */
  urlForAgent: (agentId: string) => string;
  close: () => Promise<void>;
}

/**
 * Phase 18 Milestone 2 — the built-in browser MCP server.
 *
 * A loopback HTTP server speaking MCP Streamable HTTP (the transport the
 * `@cursor/sdk` MCP client uses — see ledger OQ-24), built on the official
 * `@modelcontextprotocol/sdk`. Each agent registers
 * `harness_browser: { url: <baseUrl>/mcp/<agentId> }`; the path identifies the
 * agent, and the tool handlers are bound to that agentId (one isolated browser
 * session per agent). Runs in the same process as Fastify + the
 * `BrowserController` (Phase 16), so tools reach the controller via the
 * in-process `BrowserBackend` seam.
 *
 * Uses the SDK's stateless request pattern: a fresh `McpServer` + transport per
 * request, avoiding cross-request session bookkeeping for our single
 * in-process client.
 */
export async function startBrowserMcpServer(): Promise<BrowserMcpServer> {
  const capability = randomBytes(32).toString("base64url");
  const httpServer = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
            id: null,
          }),
        );
      }
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = /^\/mcp\/([^/?#]+)/.exec(parsedUrl.pathname);
    if (!match || match[1] === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const providedCapability = parsedUrl.searchParams.get("capability");
    if (providedCapability === null) {
      sendAuthError(res, 401);
      return;
    }
    if (!capabilityMatches(providedCapability, capability)) {
      sendAuthError(res, 403);
      return;
    }
    const agentId = decodeURIComponent(match[1]);

    const server = new McpServer({ name: BROWSER_MCP_SERVER_NAME, version: "1.0.0" });
    registerBrowserTools(server, agentId);
    // `sessionIdGenerator: undefined` selects the SDK's stateless mode (required
    // for the per-request pattern). The MCP SDK's option + Transport types
    // aren't authored for `exactOptionalPropertyTypes`, so cast at this
    // third-party boundary.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = httpServer.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const handle: BrowserMcpServer = {
    baseUrl,
    urlForAgent: (agentId: string) =>
      `${baseUrl}/mcp/${encodeURIComponent(agentId)}?capability=${encodeURIComponent(capability)}`,
    close: () =>
      new Promise<void>((resolve) => {
        activeMcpServer = null;
        httpServer.close(() => resolve());
      }),
  };
  activeMcpServer = handle;
  return handle;
}

function capabilityMatches(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

function sendAuthError(res: ServerResponse, statusCode: 401 | 403): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      error: statusCode === 401 ? "missing_capability" : "invalid_capability",
    }),
  );
}

/** Module-level handle, set once the MCP server starts. */
let activeMcpServer: BrowserMcpServer | null = null;

/**
 * Returns the per-agent MCP endpoint URL if the browser MCP server is running,
 * else null. Used by `agent-options-builder` to inject `harness_browser` into
 * `Agent.create` options.
 */
export function getBrowserMcpUrl(agentId: string): string | null {
  return activeMcpServer?.urlForAgent(agentId) ?? null;
}
