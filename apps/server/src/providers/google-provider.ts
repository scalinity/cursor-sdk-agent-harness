import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  ListModelsOptions,
  ModelProvider,
  ProviderClientConfig,
  ProviderEvent,
  ProviderModelInfo,
  ProviderOptions,
} from "./provider.js";
import { PROVIDER_CHAT_TIMEOUT_MS, PROVIDER_LIST_TIMEOUT_MS } from "./provider.js";
import { FALLBACK_MODELS } from "./model-registry.js";

/** Chat-only Google Gemini provider. */
export class GoogleProvider implements ModelProvider {
  readonly kind = "google";
  private readonly genAI: GoogleGenerativeAI;

  constructor(private readonly config: ProviderClientConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey || "__missing__");
  }

  get id(): string {
    return this.config.id;
  }
  get name(): string {
    return this.config.name;
  }

  async *sendMessage(prompt: string, options: ProviderOptions): AsyncIterable<ProviderEvent> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: options.model,
        ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
      });
      const result = await model.generateContentStream(
        { contents: [{ role: "user", parts: [{ text: prompt }] }] },
        { timeout: PROVIDER_CHAT_TIMEOUT_MS, ...(options.signal ? { signal: options.signal } : {}) },
      );
      for await (const chunk of result.stream) {
        let text = "";
        try {
          text = chunk.text();
        } catch {
          text = "";
        }
        if (text) yield { type: "text_delta", content: text };
      }
      const resp = await result.response;
      const um = resp.usageMetadata;
      if (um) {
        yield {
          type: "usage",
          usage: {
            inputTokens: um.promptTokenCount ?? 0,
            outputTokens: um.candidatesTokenCount ?? 0,
          },
        };
      }
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(options?: ListModelsOptions): Promise<ProviderModelInfo[]> {
    const known = FALLBACK_MODELS.google.map((m) => ({ id: m.name, name: m.label }));
    // @google/generative-ai 0.24 has no list endpoint. P23-W3: in validation
    // mode, do a cheap countTokens ping so a bad key fails the test (throws);
    // otherwise return the known set (validity is exercised on first send).
    if (options?.validate) {
      const first = FALLBACK_MODELS.google[0]?.name ?? "gemini-2.5-flash";
      const model = this.genAI.getGenerativeModel({ model: first });
      await model.countTokens(
        { contents: [{ role: "user", parts: [{ text: "ping" }] }] },
        { timeout: PROVIDER_LIST_TIMEOUT_MS },
      );
    }
    return known;
  }
}
