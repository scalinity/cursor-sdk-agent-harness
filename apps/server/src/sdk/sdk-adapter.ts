import { Agent as CursorAgent, type SDKAgent, type Run, type AgentOptions, type SendOptions } from "@cursor/sdk";

/**
 * Minimal seam between the harness's runtime layer and `@cursor/sdk`. The
 * production adapter (`createCursorSdkAdapter`) delegates straight to the
 * SDK's static `Agent.create`/`Agent.resume`/`Agent.cancelRun` etc. Tests
 * inject `createStubSdkAdapter()` from `./testing.js` to exercise the
 * runtime without touching the network or the user's API key.
 *
 * Why a seam instead of mocking `@cursor/sdk` module-globally?
 *  - Vitest module mocks are flaky across worker boundaries and don't
 *    survive realistic dependency injection patterns.
 *  - Integration tests need a fully-wired Fastify app + DB + Keychain. The
 *    only thing that needs to be fake is the SDK; everything else is real.
 *  - The adapter shape is intentionally minimal so a future Phase 14 can
 *    swap it for a reconnect-aware variant without touching the runtime.
 */
export interface SdkAdapter {
  /**
   * Create a new SDK agent. The returned handle's `agentId` overrides any
   * `options.agentId` we passed in; the runtime persists whichever value the
   * SDK chose so future `.resume()` calls round-trip cleanly.
   */
  createAgent(options: AgentOptions): Promise<SDKAgent>;
  /**
   * Resume a previously-created durable agent. Per OQ-20 the model and
   * inline MCP servers must be re-passed because the SDK does not persist
   * them across resume.
   */
  resumeAgent(agentId: string, options: Partial<AgentOptions>): Promise<SDKAgent>;
  /**
   * Send a prompt and obtain a `Run` handle. We pass `idempotencyKey` per
   * F-2 in the ledger so retries are de-duped server-side.
   */
  send(agent: SDKAgent, prompt: string, sendOptions: SendOptions): Promise<Run>;
}

export function createCursorSdkAdapter(): SdkAdapter {
  return {
    createAgent: (options) => CursorAgent.create(options),
    resumeAgent: (agentId, options) => CursorAgent.resume(agentId, options),
    send: (agent, prompt, sendOptions) => agent.send(prompt, sendOptions),
  };
}

export type { SDKAgent, Run, AgentOptions, SendOptions };
