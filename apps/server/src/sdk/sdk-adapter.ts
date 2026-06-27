import {
  Agent as CursorAgent,
  Cursor,
  CursorSdkError,
  wrapSdkError,
  type SDKAgent,
  type Run,
  type AgentOptions,
  type SendOptions,
  type SDKModel,
  type SDKUserMessage,
} from "@cursor/sdk";
import type { SdkImage } from "@harness/shared";

/**
 * Harness-side user message passed to {@link SdkAdapter.send}. `images` uses
 * the harness `SdkImage` (zod-inferred, so `dimension?` is `X | undefined`).
 * The production adapter casts this to the SDK's `SDKUserMessage` at the
 * `agent.send` call — the only difference is that zod `.optional()` widens
 * `dimension` with `| undefined` while the SDK's hand-written `.d.ts` does
 * not; at runtime zod omits absent keys, so the shapes match. Verified SDK
 * signature: `send(message: string | SDKUserMessage, options?)` (agent.d.ts).
 */
export interface SdkUserMessageInput {
  text: string;
  images?: SdkImage[];
}

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
  send(agent: SDKAgent, message: string | SdkUserMessageInput, sendOptions: SendOptions): Promise<Run>;
  /**
   * List the models available to the authenticated user, with each model's
   * discovered parameters (thinking/reasoning effort, max mode) and preset
   * variants. Wraps `Cursor.models.list()`. The catalog is account-specific;
   * the key is passed explicitly rather than relying on the env fallback.
   */
  listModels(apiKey: string): Promise<SDKModel[]>;
}

async function invokeSdk<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CursorSdkError) throw err;
    throw wrapSdkError(err, { operation });
  }
}

export function createCursorSdkAdapter(): SdkAdapter {
  return {
    createAgent: (options) => invokeSdk("createAgent", () => CursorAgent.create(options)),
    resumeAgent: (agentId, options) =>
      invokeSdk("resumeAgent", () => CursorAgent.resume(agentId, options)),
    send: (agent, message, sendOptions) =>
      invokeSdk("send", () =>
        agent.send(
          // SDK-boundary cast: harness SdkImage → SDK SDKImage (see
          // SdkUserMessageInput doc — zod-optional vs exactOptionalPropertyTypes).
          typeof message === "string" ? message : (message as SDKUserMessage),
          sendOptions,
        ),
      ),
    listModels: (apiKey) =>
      invokeSdk("listModels", () => Cursor.models.list({ apiKey })),
  };
}

export type { SDKAgent, Run, AgentOptions, SendOptions, SDKModel, SDKUserMessage };
