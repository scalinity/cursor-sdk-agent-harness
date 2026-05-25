import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  ModelProvider,
  ProviderClientConfig,
  ProviderEvent,
  ProviderModelInfo,
  ProviderOptions,
} from "./provider.js";
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
        options.signal ? { signal: options.signal } : {},
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

  listModels(): Promise<ProviderModelInfo[]> {
    // @google/generative-ai 0.24 has no first-class list helper; use the
    // known set. Key validity is exercised on first send.
    return Promise.resolve(FALLBACK_MODELS.google.map((m) => ({ id: m.name, name: m.label })));
  }
}
