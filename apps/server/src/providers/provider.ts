/**
 * Phase 23 — provider abstraction.
 *
 * Non-Cursor providers are **chat-only** (Ask / Plan): they receive an
 * assembled prompt and stream back text (+ optional thinking) and usage. They
 * have no tool-use infrastructure — that stays exclusive to the Cursor SDK
 * path. The `ProviderEvent` stream is normalized into the harness's canonical
 * events by the ProviderRunController so streaming surfaces + replay work
 * identically to a Cursor run.
 */

export interface ProviderOptions {
  model: string;
  systemPrompt?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderEvent =
  | { type: "text_delta"; content: string }
  | { type: "thinking_delta"; content: string }
  | { type: "usage"; usage: ProviderUsage }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ProviderModelInfo {
  id: string;
  name: string;
}

export interface ListModelsOptions {
  /**
   * P23-W3: when true, the connection test wants real validation — providers
   * must let API/auth errors propagate instead of falling back to a static
   * list, so an invalid key surfaces as a failed test rather than fake success.
   */
  validate?: boolean;
}

export interface ModelProvider {
  /** The provider config row id (or the literal "cursor"). */
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  sendMessage(prompt: string, options: ProviderOptions): AsyncIterable<ProviderEvent>;
  /** List available models — used by the test-connection endpoint + /api/models. */
  listModels(options?: ListModelsOptions): Promise<ProviderModelInfo[]>;
}

/** P23-C5: bounded timeouts so a wedged provider can't hang a run/endpoint forever. */
export const PROVIDER_CHAT_TIMEOUT_MS = 120_000;
export const PROVIDER_LIST_TIMEOUT_MS = 15_000;

export interface ProviderClientConfig {
  id: string;
  name: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

export const DEFAULT_MAX_TOKENS = 4096;
