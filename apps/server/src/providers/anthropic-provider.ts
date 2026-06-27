import Anthropic from "@anthropic-ai/sdk";
import type {
  ListModelsOptions,
  ModelProvider,
  ProviderClientConfig,
  ProviderEvent,
  ProviderOptions,
  ProviderModelInfo,
} from "./provider.js";
import { DEFAULT_MAX_TOKENS, PROVIDER_CHAT_TIMEOUT_MS } from "./provider.js";
import { FALLBACK_MODELS } from "./model-registry.js";

/** Chat-only Anthropic provider (Claude Opus / Sonnet / Haiku). */
export class AnthropicProvider implements ModelProvider {
  readonly kind = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly config: ProviderClientConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey || "__missing__",
      timeout: PROVIDER_CHAT_TIMEOUT_MS, // P23-C5
      maxRetries: 1,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  get id(): string {
    return this.config.id;
  }
  get name(): string {
    return this.config.name;
  }

  async *sendMessage(prompt: string, options: ProviderOptions): AsyncIterable<ProviderEvent> {
    try {
      const stream = this.client.messages.stream(
        {
          model: options.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages: [{ role: "user", content: prompt }],
          ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        },
        options.signal ? { signal: options.signal } : undefined,
      );
      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        const delta = event.delta as { type: string; text?: string; thinking?: string };
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "text_delta", content: delta.text };
        } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          yield { type: "thinking_delta", content: delta.thinking };
        }
      }
      const final = await stream.finalMessage();
      yield {
        type: "usage",
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        },
      };
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(options?: ListModelsOptions): Promise<ProviderModelInfo[]> {
    const fallback = (): ProviderModelInfo[] =>
      FALLBACK_MODELS.anthropic.map((m) => ({ id: m.name, name: m.label }));
    const fetchReal = async (): Promise<ProviderModelInfo[]> => {
      const page = await this.client.models.list();
      const data = (page as { data?: Array<{ id: string; display_name?: string }> }).data ?? [];
      return data.map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
    };
    // P23-W3: validation mode lets auth/network errors propagate so a bad key
    // fails the connection test instead of silently degrading to the static list.
    if (options?.validate) {
      const out = await fetchReal();
      return out.length > 0 ? out : fallback();
    }
    try {
      const out = await fetchReal();
      if (out.length > 0) return out;
    } catch {
      // Populating mode — degrade to the static list.
    }
    return fallback();
  }
}
