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

export interface ModelProvider {
  /** The provider config row id (or the literal "cursor"). */
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  sendMessage(prompt: string, options: ProviderOptions): AsyncIterable<ProviderEvent>;
  /** List available models — used by the test-connection endpoint + /api/models. */
  listModels(): Promise<ProviderModelInfo[]>;
}

export interface ProviderClientConfig {
  id: string;
  name: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

export const DEFAULT_MAX_TOKENS = 4096;
