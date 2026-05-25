import type {
  ListModelsOptions,
  ModelProvider,
  ProviderClientConfig,
  ProviderEvent,
  ProviderModelInfo,
  ProviderOptions,
} from "./provider.js";
import { PROVIDER_CHAT_TIMEOUT_MS, PROVIDER_LIST_TIMEOUT_MS } from "./provider.js";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/** Combine the caller's abort signal (if any) with a hard timeout. P23-C5. */
function withTimeout(timeoutMs: number, caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

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
        signal: withTimeout(PROVIDER_CHAT_TIMEOUT_MS, options.signal),
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
          // P23-W6: a single malformed line (proxy keep-alive, partial chunk)
          // must not kill an otherwise-good stream — skip it and continue.
          let obj: OllamaChatLine;
          try {
            obj = JSON.parse(line) as OllamaChatLine;
          } catch {
            continue;
          }
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
    } finally {
      // P23-W4: release the underlying socket on every exit path.
      await reader.cancel().catch(() => {});
    }
  }

  async listModels(options?: ListModelsOptions): Promise<ProviderModelInfo[]> {
    const fetchTags = async (): Promise<ProviderModelInfo[]> => {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: withTimeout(PROVIDER_LIST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Ollama /api/tags failed (${res.status})`);
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      return (json.models ?? []).map((m) => ({ id: m.name, name: m.name }));
    };
    // P23-W3: validation mode lets connection failures surface; populating
    // mode degrades to an empty list (no daemon running yet is not fatal).
    if (options?.validate) return fetchTags();
    try {
      return await fetchTags();
    } catch {
      return [];
    }
  }
}
