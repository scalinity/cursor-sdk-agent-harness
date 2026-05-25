import type {
  ModelProvider,
  ProviderClientConfig,
  ProviderEvent,
  ProviderModelInfo,
  ProviderOptions,
} from "./provider.js";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

interface OllamaChatLine {
  message?: { content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Local Ollama provider over its HTTP API (no SDK, no key). */
export class OllamaProvider implements ModelProvider {
  readonly kind = "ollama";
  private readonly baseUrl: string;

  constructor(private readonly config: ProviderClientConfig) {
    this.baseUrl = (config.baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  }

  get id(): string {
    return this.config.id;
  }
  get name(): string {
    return this.config.name;
  }

  async *sendMessage(prompt: string, options: ProviderOptions): AsyncIterable<ProviderEvent> {
    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: options.model, stream: true, messages }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }
    if (!res.ok || !res.body) {
      yield { type: "error", message: `Ollama request failed (${res.status})` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const obj = JSON.parse(line) as OllamaChatLine;
          if (obj.message?.content) {
            yield { type: "text_delta", content: obj.message.content };
          }
          if (obj.done) {
            yield {
              type: "usage",
              usage: {
                inputTokens: obj.prompt_eval_count ?? 0,
                outputTokens: obj.eval_count ?? 0,
              },
            };
          }
        }
      }
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      return (json.models ?? []).map((m) => ({ id: m.name, name: m.name }));
    } catch {
      return [];
    }
  }
}
