import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelProvider,
  ProviderClientConfig,
  ProviderEvent,
  ProviderModelInfo,
  ProviderOptions,
} from "./provider.js";
import { DEFAULT_MAX_TOKENS } from "./provider.js";
import { FALLBACK_MODELS } from "./model-registry.js";

/** Chat-only Anthropic provider (Claude Opus / Sonnet / Haiku). */
export class AnthropicProvider implements ModelProvider {
  readonly kind = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly config: ProviderClientConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey || "__missing__",
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

  async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const page = await this.client.models.list();
      const data = (page as { data?: Array<{ id: string; display_name?: string }> }).data ?? [];
      const out = data.map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
      if (out.length > 0) return out;
    } catch {
      // Fall through to the static list (key may be invalid — surfaced by test).
    }
    return FALLBACK_MODELS.anthropic.map((m) => ({ id: m.name, name: m.label }));
  }
}
