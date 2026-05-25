import OpenAI from "openai";
import type {
  ModelProvider,
  ProviderClientConfig,
  ProviderEvent,
  ProviderModelInfo,
  ProviderOptions,
} from "./provider.js";
import { FALLBACK_MODELS } from "./model-registry.js";

/** Chat-only OpenAI provider (GPT-5 / GPT-4.1 / …). */
export class OpenAIProvider implements ModelProvider {
  readonly kind = "openai";
  private readonly client: OpenAI;

  constructor(private readonly config: ProviderClientConfig) {
    this.client = new OpenAI({
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
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: options.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        },
        options.signal ? { signal: options.signal } : undefined,
      );
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield { type: "text_delta", content: delta };
        }
        if (chunk.usage) {
          yield {
            type: "usage",
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            },
          };
        }
      }
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const page = await this.client.models.list();
      const out = page.data.map((m) => ({ id: m.id, name: m.id }));
      if (out.length > 0) return out;
    } catch {
      // Fall through to the static list.
    }
    return FALLBACK_MODELS.openai.map((m) => ({ id: m.name, name: m.label }));
  }
}
