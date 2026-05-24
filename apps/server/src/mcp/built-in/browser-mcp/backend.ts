import type { z } from "zod";
import type {
  browserClickOutputSchema,
  browserConsoleMessagesOutputSchema,
  browserEvaluateOutputSchema,
  browserHistoryOutputSchema,
  browserNavigateOutputSchema,
  browserNetworkRequestsOutputSchema,
  browserScreenshotOutputSchema,
  browserSnapshotOutputSchema,
  browserStateSchema,
  browserTypeOutputSchema,
  browserWaitForOutputSchema,
  ConsoleLevel,
  WaitCondition,
} from "@harness/shared";

/**
 * Phase 18 Milestone 2 — the seam between the built-in browser MCP server
 * (in `apps/server`) and the Electron `BrowserController` (in `apps/desktop`).
 *
 * `apps/server` must not import `apps/desktop` (import direction). Instead the
 * desktop main process injects a `BrowserBackend` implementation at startup via
 * `registerBrowserBackend`. The MCP tool handlers and the browser REST routes
 * call through the registered backend. In browser-only dev mode (no Electron)
 * the backend is null and tools return a clear "unavailable outside the desktop
 * app" error — honest, not faked.
 *
 * Because Phase 16 runs Fastify inside the Electron main process, this is an
 * in-process function call, not Electron IPC.
 */

type NavigateOutput = z.infer<typeof browserNavigateOutputSchema>;
type ScreenshotOutput = z.infer<typeof browserScreenshotOutputSchema>;
type SnapshotOutput = z.infer<typeof browserSnapshotOutputSchema>;
type ClickOutput = z.infer<typeof browserClickOutputSchema>;
type TypeOutput = z.infer<typeof browserTypeOutputSchema>;
type EvaluateOutput = z.infer<typeof browserEvaluateOutputSchema>;
type ConsoleOutput = z.infer<typeof browserConsoleMessagesOutputSchema>;
type NetworkOutput = z.infer<typeof browserNetworkRequestsOutputSchema>;
type WaitForOutput = z.infer<typeof browserWaitForOutputSchema>;
type HistoryOutput = z.infer<typeof browserHistoryOutputSchema>;
type BrowserState = z.infer<typeof browserStateSchema>;

export interface BrowserWaitForInput {
  text?: string;
  ref?: string;
  ms?: number;
  timeoutMs?: number;
}

/**
 * The agent-facing browser action surface, scoped per `agentId` (one isolated
 * session per agent). Implemented by `apps/desktop`'s `BrowserController`.
 */
export interface BrowserBackend {
  navigate(agentId: string, url: string, waitUntil?: WaitCondition): Promise<NavigateOutput>;
  screenshot(agentId: string, fullPage?: boolean): Promise<ScreenshotOutput>;
  snapshot(agentId: string): Promise<SnapshotOutput>;
  click(agentId: string, ref: string): Promise<ClickOutput>;
  type(agentId: string, ref: string, text: string, submit?: boolean): Promise<TypeOutput>;
  evaluate(agentId: string, expression: string): Promise<EvaluateOutput>;
  consoleMessages(agentId: string, levels?: ConsoleLevel[], since?: number): Promise<ConsoleOutput>;
  networkRequests(agentId: string, filter?: string, since?: number): Promise<NetworkOutput>;
  waitFor(agentId: string, input: BrowserWaitForInput): Promise<WaitForOutput>;
  back(agentId: string): Promise<HistoryOutput>;
  forward(agentId: string): Promise<HistoryOutput>;
  reload(agentId: string): Promise<HistoryOutput>;
  /** Live state for the REST `/state` endpoint. */
  state(agentId: string): Promise<BrowserState>;
}

/** Thrown by tool handlers / routes when no backend is registered. */
export class BrowserBackendUnavailableError extends Error {
  readonly code = "BROWSER_BACKEND_UNAVAILABLE" as const;
  constructor() {
    super("The embedded browser is only available in the desktop app.");
    this.name = "BrowserBackendUnavailableError";
  }
}

let registered: BrowserBackend | null = null;

/** Called once by the Electron main process after `startServer()`. */
export function registerBrowserBackend(backend: BrowserBackend | null): void {
  registered = backend;
}

export function getBrowserBackend(): BrowserBackend {
  if (registered === null) throw new BrowserBackendUnavailableError();
  return registered;
}

export function hasBrowserBackend(): boolean {
  return registered !== null;
}
