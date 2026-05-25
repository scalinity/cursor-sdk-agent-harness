/// <reference lib="webworker" />
import {
  pipeline,
  env,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

/**
 * Whisper speech-to-text in a dedicated worker. Inference and the one-time model
 * load run off the main thread, and Vite emits this as a separate chunk fetched
 * only when the user first records.
 *
 * Primary path is WebGPU (the desktop shell's `enable-unsafe-webgpu` switch
 * exposes `navigator.gpu` to this worker) running large-v3-turbo — the highest-
 * fidelity model that's practical on-device and ~10x faster than WASM on an
 * Apple GPU. If WebGPU is unavailable the worker falls back to a small WASM
 * model so dictation still works (slower, lower fidelity).
 *
 * `allowLocalModels = false`: weights are fetched from the HF hub on first use
 * then served from the browser cache (offline thereafter — no audio or text
 * ever leaves the machine).
 *
 * `numThreads = 1`: the packaged renderer's `app://harness` origin is not
 * cross-origin-isolated, so multi-threaded WASM (SharedArrayBuffer) is
 * unavailable; pinning to one thread avoids a probe + fallback warning.
 */
env.allowLocalModels = false;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

// Highest-fidelity on-device model. Multilingual, but used English-only here
// (language is forced below). Encoder fp16 preserves acoustic fidelity; the
// large decoder is q4f16 to cut the download (~600-800 MB) and VRAM while
// staying fast on WebGPU — turbo is robust to 4-bit. Switch the decoder to
// "fp16" for absolute-max fidelity at a ~1.5 GB download.
const WEBGPU_MODEL = "onnx-community/whisper-large-v3-turbo";

// Reliable-everywhere fallback when there's no GPU. base.en in fp32 avoids the
// MatMulNBits/WASM session-creation bug that the quantized exports trip.
const WASM_MODEL = "Xenova/whisper-base.en";

/** Main thread → worker. */
export interface WhisperTranscribeRequest {
  readonly type: "transcribe";
  /** Mono PCM at 16 kHz — the sample rate Whisper expects. */
  readonly audio: Float32Array;
  /** Monotonic id of the phrase this audio belongs to (see useSpeechToText). */
  readonly phraseId: number;
  /**
   * True for the pass fired when the phrase ends (a pause): its result is
   * committed permanently. False for the interim passes that refine the phrase
   * live while it is still being spoken.
   */
  readonly final: boolean;
}

/** Worker → main thread. `phraseId`/`final` echo the request that produced it. */
export type WhisperResponse =
  | { readonly type: "progress"; readonly progress: number }
  | {
      readonly type: "partial";
      readonly text: string;
      readonly phraseId: number;
      readonly final: boolean;
    }
  | {
      readonly type: "result";
      readonly text: string;
      readonly phraseId: number;
      readonly final: boolean;
    }
  | {
      readonly type: "error";
      readonly message: string;
      readonly phraseId: number;
      readonly final: boolean;
    };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function postProgress(info: unknown): void {
  const progress = (info as { progress?: number }).progress;
  if (typeof progress === "number" && Number.isFinite(progress)) {
    ctx.postMessage({ type: "progress", progress } satisfies WhisperResponse);
  }
}

let asrPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
function loadAsr(): Promise<AutomaticSpeechRecognitionPipeline> {
  asrPromise ??= (async () => {
    const hasWebGPU =
      typeof navigator !== "undefined" && (navigator as { gpu?: unknown }).gpu != null;
    if (hasWebGPU) {
      try {
        return await pipeline("automatic-speech-recognition", WEBGPU_MODEL, {
          device: "webgpu",
          dtype: { encoder_model: "fp16", decoder_model_merged: "q4f16" },
          progress_callback: postProgress,
        });
      } catch {
        // WebGPU is present but the GPU model failed to build — fall through to
        // the WASM model rather than leaving dictation broken.
      }
    }
    return pipeline("automatic-speech-recognition", WASM_MODEL, {
      device: "wasm",
      dtype: "fp32",
      progress_callback: postProgress,
    });
  })();
  return asrPromise;
}

// One inference at a time (single GPU / worker thread). Phrase-commit (`final`)
// requests are queued FIFO and never dropped — every spoken phrase must be
// transcribed and committed in order. Interim (refine-in-progress) requests keep
// only the newest, since each re-transcribes the whole current phrase and
// supersedes the previous one. Finals take priority so a commit is never delayed
// behind interim refinement.
const finalQueue: WhisperTranscribeRequest[] = [];
let interimPending: WhisperTranscribeRequest | null = null;
let running = false;

ctx.addEventListener("message", (event: MessageEvent<WhisperTranscribeRequest>) => {
  const req = event.data;
  if (req.type !== "transcribe") return;
  if (req.final) finalQueue.push(req);
  else interimPending = req;
  void pump();
});

function nextRequest(): WhisperTranscribeRequest | null {
  const final = finalQueue.shift();
  if (final) return final;
  const interim = interimPending;
  interimPending = null;
  return interim;
}

async function pump(): Promise<void> {
  if (running) return;
  const req = nextRequest();
  if (!req) return;
  running = true;
  try {
    await transcribe(req);
  } finally {
    running = false;
    if (finalQueue.length > 0 || interimPending) void pump();
  }
}

async function transcribe(req: WhisperTranscribeRequest): Promise<void> {
  let asr: AutomaticSpeechRecognitionPipeline;
  try {
    asr = await loadAsr();
  } catch (err) {
    // A load failure leaves the pipeline unusable; drop the cached promise so a
    // later phrase can retry. Tag it so the main thread can show a friendly
    // connection-oriented message.
    asrPromise = null;
    ctx.postMessage({
      type: "error",
      phraseId: req.phraseId,
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
            phraseId: req.phraseId,
            final: req.final,
            text: streamed.trim(),
          } satisfies WhisperResponse);
        },
      },
    );

    // Force English so multilingual turbo doesn't language-hop between short
    // phrases. Each request is a single phrase (< 30 s), so no chunking needed.
    const output = await asr(req.audio, {
      language: "english",
      task: "transcribe",
      streamer,
    });
    const text = Array.isArray(output)
      ? output.map((chunk) => chunk.text).join(" ")
      : output.text;
    ctx.postMessage({
      type: "result",
      phraseId: req.phraseId,
      final: req.final,
      text: text.trim(),
    } satisfies WhisperResponse);
  } catch (err) {
    ctx.postMessage({
      type: "error",
      phraseId: req.phraseId,
      final: req.final,
      message: describe(err),
    } satisfies WhisperResponse);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
