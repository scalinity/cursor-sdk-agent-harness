/// <reference lib="webworker" />
import {
  pipeline,
  env,
  WhisperTextStreamer,
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
 * `allowLocalModels = false`: we don't ship the weights. The model is fetched
 * from the HF hub on first use, then served from the browser cache (offline
 * thereafter — no audio or text ever leaves the machine).
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

// English-only `tiny` model in full precision (fp32).
//
// Why fp32, not the smaller q8: the 8-bit `decoder_model_merged` export
// contains `MatMulNBits` nodes that the WASM build of onnxruntime-web bundled
// with @huggingface/transformers@4.2.0 cannot deserialize — session creation
// aborts with "TransposeDQWeightsForMatMulNBits Missing required scale:
// model.decoder.embed_tokens.weight_merged_0_scale". That was the "couldn't
// download the model" error: the weights downloaded fine; *loading* them threw.
// fp32 has no quantized matmuls, so the session always builds.
//
// Why tiny, not base: dictation re-transcribes the whole growing buffer on a
// ~1s cadence so text lands in the composer live (see useSpeechToText). tiny.en
// keeps each pass fast enough on single-thread WASM to feel live and holds the
// one-time fp32 download to ~150 MB. Bump to "Xenova/whisper-base.en" to trade
// a ~290 MB download and slower passes for higher accuracy.
const MODEL_ID = "Xenova/whisper-tiny.en";

/** Main thread → worker. */
export interface WhisperTranscribeRequest {
  readonly type: "transcribe";
  /** Mono PCM at 16 kHz — the sample rate Whisper expects. */
  readonly audio: Float32Array;
  /**
   * True only for the pass fired when recording stops: its result is the
   * authoritative transcript and the signal that dictation is complete. False
   * for the interim passes that run while the user is still speaking.
   */
  readonly final: boolean;
}

/** Worker → main thread. `final` echoes the request that produced it. */
export type WhisperResponse =
  | { readonly type: "progress"; readonly progress: number }
  // Streamed mid-inference: the transcript decoded so far in the current pass.
  | { readonly type: "partial"; readonly text: string; readonly final: boolean }
  | { readonly type: "result"; readonly text: string; readonly final: boolean }
  | { readonly type: "error"; readonly message: string; readonly final: boolean };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let asrPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
function loadAsr(): Promise<AutomaticSpeechRecognitionPipeline> {
  asrPromise ??= pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: "fp32",
    progress_callback: (info: unknown) => {
      const progress = (info as { progress?: number }).progress;
      if (typeof progress === "number" && Number.isFinite(progress)) {
        ctx.postMessage({ type: "progress", progress } satisfies WhisperResponse);
      }
    },
  });
  return asrPromise;
}

// One inference at a time (the worker is single-threaded). While a pass runs,
// only the newest pending request is retained — interim snapshots that arrive
// mid-pass supersede each other, so a backlog never builds and the live view
// always reflects the freshest audio. The final pass is the last request
// enqueued (recording has stopped), so it can never be dropped.
let pending: WhisperTranscribeRequest | null = null;
let running = false;

ctx.addEventListener("message", (event: MessageEvent<WhisperTranscribeRequest>) => {
  if (event.data.type !== "transcribe") return;
  pending = event.data;
  void pump();
});

async function pump(): Promise<void> {
  if (running) return;
  const req = pending;
  pending = null;
  if (!req) return;
  running = true;
  try {
    await transcribe(req);
  } finally {
    running = false;
    if (pending) void pump();
  }
}

async function transcribe(req: WhisperTranscribeRequest): Promise<void> {
  let asr: AutomaticSpeechRecognitionPipeline;
  try {
    asr = await loadAsr();
  } catch (err) {
    // A load failure leaves the pipeline unusable; drop the cached promise so a
    // later recording can retry the download/compile from scratch. Tag it so
    // the main thread can surface a connection-oriented message.
    asrPromise = null;
    ctx.postMessage({
      type: "error",
      final: req.final,
      message: `model-load: ${describe(err)}`,
    } satisfies WhisperResponse);
    return;
  }

  try {
    let streamed = "";
    const streamer = new WhisperTextStreamer(
      // A whisper pipeline's tokenizer is a WhisperTokenizer at runtime; the
      // pipeline types it as the PreTrainedTokenizer base. Narrow to the
      // streamer's expected param type at this library boundary.
      asr.tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0],
      {
        callback_function: (text: string) => {
          streamed += text;
          ctx.postMessage({
            type: "partial",
            final: req.final,
            text: streamed.trim(),
          } satisfies WhisperResponse);
        },
      },
    );

    // No chunking: whisper's native 30 s window covers a dictation utterance,
    // and a single pass keeps the streamed partials clean (chunk overlap would
    // duplicate text in the live view). Speech past ~30 s in one unbroken take
    // is truncated — acceptable for a composer dictation box.
    const output = await asr(req.audio, { streamer });
    const text = Array.isArray(output)
      ? output.map((chunk) => chunk.text).join(" ")
      : output.text;
    ctx.postMessage({
      type: "result",
      final: req.final,
      text: text.trim(),
    } satisfies WhisperResponse);
  } catch (err) {
    ctx.postMessage({
      type: "error",
      final: req.final,
      message: describe(err),
    } satisfies WhisperResponse);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
