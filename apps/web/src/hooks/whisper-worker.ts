/// <reference lib="webworker" />
import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

/**
 * Whisper speech-to-text, running entirely on-device inside this dedicated
 * worker. Two reasons it lives off the main thread:
 *  - inference (and the one-time model load) would otherwise block the UI;
 *  - it keeps the heavy `@huggingface/transformers` graph out of the main
 *    bundle — Vite emits this file as a separate chunk that is only fetched
 *    when the user first records.
 *
 * `allowLocalModels = false`: we don't ship the weights. The quantized model
 * is fetched from the HF hub on first use, then served from the browser cache
 * (offline thereafter — no audio or text ever leaves the machine).
 *
 * `numThreads = 1`: the packaged renderer's `app://harness` origin is not
 * cross-origin-isolated, so `SharedArrayBuffer` (multi-threaded WASM) is
 * unavailable. Pinning to one thread avoids ONNX Runtime probing for it and
 * logging a fallback warning on every load.
 */
env.allowLocalModels = false;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

// English-only base model, 8-bit quantized (~80 MB). base.en is a clear
// accuracy step up from tiny.en for dictation while staying small enough for
// a tolerable one-time download.
const MODEL_ID = "Xenova/whisper-base.en";

/** Main thread → worker. */
export interface WhisperTranscribeRequest {
  readonly type: "transcribe";
  /** Mono PCM at 16 kHz — the sample rate Whisper expects. */
  readonly audio: Float32Array;
}

/** Worker → main thread. */
export type WhisperResponse =
  | { readonly type: "progress"; readonly progress: number }
  | { readonly type: "result"; readonly text: string }
  | { readonly type: "error"; readonly message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let asrPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
function loadAsr(): Promise<AutomaticSpeechRecognitionPipeline> {
  asrPromise ??= pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: "q8",
    progress_callback: (info: unknown) => {
      const progress = (info as { progress?: number }).progress;
      if (typeof progress === "number" && Number.isFinite(progress)) {
        ctx.postMessage({ type: "progress", progress } satisfies WhisperResponse);
      }
    },
  });
  return asrPromise;
}

ctx.addEventListener("message", (event: MessageEvent<WhisperTranscribeRequest>) => {
  void transcribe(event.data);
});

async function transcribe(req: WhisperTranscribeRequest): Promise<void> {
  if (req.type !== "transcribe") return;
  try {
    const asr = await loadAsr();
    const output = await asr(req.audio);
    const text = Array.isArray(output)
      ? output.map((chunk) => chunk.text).join(" ")
      : output.text;
    ctx.postMessage({ type: "result", text: text.trim() } satisfies WhisperResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: "error", message } satisfies WhisperResponse);
  }
}
