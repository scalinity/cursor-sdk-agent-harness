/**
 * useSpeechToText — live, on-device dictation for the composer, gated by voice
 * activity so it neither erases itself nor transcribes room noise.
 *
 * How it works: Silero VAD (`@ricky0123/vad-web`) listens to the mic and splits
 * speech into phrases — silence, keyboard clicks, and other non-speech never
 * reach the model. Each phrase streams in live as it's spoken (interim passes,
 * refined word by word) and is *committed* permanently when you pause. Committed
 * text is never re-decoded, so finished phrases can never rewrite themselves;
 * only the phrase you're currently speaking updates. Whisper large-v3-turbo runs
 * on the GPU (see whisper-worker) for fidelity.
 *
 * Why a hook (and not inline in the component): it owns imperative, non-React
 * state — the VAD instance, the Whisper `Worker`, the in-progress audio buffer,
 * and the committed/interim transcript — plus their teardown. Per the repo's
 * effects policy that belongs in a hook, where a single `useMountEffect` cleanup
 * tears everything down on unmount.
 *
 * Feature detection (`supported`) is deliberate: in the packaged Electron app
 * `getUserMedia`/`AudioContext`/`Worker` all exist, but under jsdom (tests) they
 * don't, so the hook degrades to an inert, disabled control rather than throwing
 * on construction.
 */
import { useCallback, useRef, useState } from "react";
import type { MicVAD } from "@ricky0123/vad-web";
import { useErrorReporter } from "./useErrorReporter.js";
import { useMountEffect } from "./useMountEffect.js";
import type {
  WhisperResponse,
  WhisperTranscribeRequest,
} from "./whisper-worker.js";

export type SpeechToTextStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing";

export interface UseSpeechToTextOptions {
  /**
   * The full dictation transcript so far — committed phrases plus the phrase
   * currently being spoken. Fired live as you talk and again on each commit.
   * The composer prepends whatever was typed before dictation began.
   */
  onTranscript: (text: string) => void;
}

export interface SpeechToText {
  /** False where the browser APIs are missing (e.g. jsdom). */
  readonly supported: boolean;
  readonly status: SpeechToTextStatus;
  readonly isRecording: boolean;
  /** 0–100 while the model downloads/compiles on first use; null otherwise. */
  readonly modelProgress: number | null;
  /** Start listening when idle, stop+finalize when recording. */
  readonly toggle: () => void;
}

// Worklet, Silero model, AND onnxruntime-web WASM are self-hosted under
// public/vad/ (copied from node_modules by scripts/copy-vad-assets.mjs).
// The ort WASM glue (.mjs) is loaded via a runtime-constructed dynamic import()
// that Vite can't rewrite, so it must live at the exact filename ort expects.
const VAD_ASSET_PATH = "/vad/";

// Refine the in-progress phrase at most this often — frequent enough to feel
// live, sparse enough not to thrash the GPU (the worker also coalesces).
const INTERIM_INTERVAL_MS = 600;

// Ignore sub-0.1s audio (an accidental blip) — nothing meaningful to transcribe.
const MIN_SAMPLES = 1600;

function detectSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioContext !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined"
  );
}

/** Join non-empty transcript fragments with single spaces. */
function joinText(...parts: readonly string[]): string {
  return parts.filter((p) => p.length > 0).join(" ");
}

/** Flatten accumulated VAD frames into one contiguous PCM buffer. */
function concatFrames(frames: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const frame of frames) length += frame.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return out;
}

/** Map a worker error (which may be raw ONNX Runtime noise) to friendly text. */
function friendlyError(message: string): string {
  if (message.startsWith("model-load:")) {
    return "Couldn't load the voice model — check your connection and try again.";
  }
  return `Dictation failed: ${message}`;
}

// S2: The result never changes during the app's lifetime — hoist to module scope.
const SUPPORTED = detectSupport();

export function useSpeechToText({ onTranscript }: UseSpeechToTextOptions): SpeechToText {
  const supported = SUPPORTED;
  const [status, setStatus] = useState<SpeechToTextStatus>("idle");
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const { report } = useErrorReporter("speech-to-text");

  // Keep the latest callback without re-subscribing the worker each render.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const workerRef = useRef<Worker | null>(null);
  const vadRef = useRef<MicVAD | null>(null);

  // Transcript state. `committed` is the join of finalized phrases and never
  // changes once written; `interim` is the live text of the phrase in progress.
  const committedRef = useRef("");
  const interimRef = useRef("");

  // Phrase bookkeeping. `activePhraseId` is the id of the phrase currently being
  // spoken (null between phrases); interim results for any other id are stale and
  // ignored. `pendingFinals` counts commit passes still in flight so a stop can
  // wait for them. `stopping` flips the status to idle once they drain.
  const phraseSeqRef = useRef(0);
  const activePhraseIdRef = useRef<number | null>(null);
  const segmentFramesRef = useRef<Float32Array[]>([]);
  const lastInterimAtRef = useRef(0);
  const pendingFinalsRef = useRef(0);
  const stoppingRef = useRef(false);
  // C1: Tracks the phraseId we expect for the next committed final — a cheap
  // ordering assertion that catches silent transcript corruption if the worker's
  // FIFO invariant is ever violated by a future refactor.
  const nextCommitIdRef = useRef(1);
  // W5: Ref-based guard against a double-start race (two rapid clicks both see
  // status==="idle" before React batches the first start's state update).
  const startingRef = useRef(false);
  // Suppress identical worker/VAD error spam (e.g. ONNX WebGPU flakes in Electron).
  const lastErrorToastRef = useRef<string | null>(null);

  const emit = useCallback(() => {
    onTranscriptRef.current(joinText(committedRef.current, interimRef.current));
  }, []);

  const finishStopIfDrained = useCallback(() => {
    if (stoppingRef.current && pendingFinalsRef.current <= 0) {
      stoppingRef.current = false;
      setStatus("idle");
    }
  }, []);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("./whisper-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<WhisperResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case "progress":
          setModelProgress(Math.round(msg.progress));
          return;
        case "partial":
          // Live words for the phrase still being spoken; ignore anything for an
          // already-finished phrase (a late refine arriving after its commit).
          if (msg.phraseId === activePhraseIdRef.current) {
            interimRef.current = msg.text;
            emit();
          }
          return;
        case "result":
          setModelProgress(null);
          if (msg.final) {
            // C1: assert ordering
            if (msg.phraseId !== nextCommitIdRef.current) {
              console.warn(
                `[speech-to-text] out-of-order final: expected ${nextCommitIdRef.current}, got ${msg.phraseId}`,
              );
            }
            nextCommitIdRef.current = msg.phraseId + 1;
            // Commit the phrase permanently.
            if (msg.text.length > 0) {
              committedRef.current = joinText(committedRef.current, msg.text);
            }
            // W3: Only clear interim if this final belongs to the currently
            // active phrase (or no phrase is active). Otherwise a commit for
            // phrase N arriving while N+1 is mid-stream would wipe N+1's text.
            if (activePhraseIdRef.current === null || msg.phraseId === activePhraseIdRef.current) {
              interimRef.current = "";
            }
            pendingFinalsRef.current -= 1;
            emit();
            finishStopIfDrained();
          } else if (msg.phraseId === activePhraseIdRef.current) {
            interimRef.current = msg.text;
            emit();
          }
          return;
        case "error":
          setModelProgress(null);
          if (msg.final) {
            pendingFinalsRef.current -= 1;
            finishStopIfDrained();
          }
          {
            const toast = friendlyError(msg.message);
            if (lastErrorToastRef.current !== toast) {
              lastErrorToastRef.current = toast;
              report(toast, { severity: "warn" });
            }
          }
          return;
        default: {
          const _exhaustive: never = msg;
          void _exhaustive;
        }
      }
    });
    workerRef.current = worker;
    return worker;
  }, [emit, finishStopIfDrained, report]);

  const sendTranscribe = useCallback(
    (audio: Float32Array, phraseId: number, final: boolean) => {
      if (audio.length < MIN_SAMPLES) return;
      // `audio` is freshly allocated (concat for interim, VAD-owned slice for
      // final), so it's safe to transfer rather than clone.
      ensureWorker().postMessage(
        { type: "transcribe", audio, phraseId, final } satisfies WhisperTranscribeRequest,
        [audio.buffer],
      );
    },
    [ensureWorker],
  );

  const start = useCallback(async (): Promise<void> => {
    // W5: Prevent double-start from rapid clicks — React's batched state
    // update means two synchronous toggle() calls both see status==="idle".
    if (startingRef.current) return;
    startingRef.current = true;
    setStatus("requesting");
    // Reset transcript + phrase state for a fresh session.
    committedRef.current = "";
    interimRef.current = "";
    phraseSeqRef.current = 0;
    activePhraseIdRef.current = null;
    segmentFramesRef.current = [];
    lastInterimAtRef.current = 0;
    pendingFinalsRef.current = 0;
    nextCommitIdRef.current = 1;
    stoppingRef.current = false;
    lastErrorToastRef.current = null;
    setModelProgress(null);

    try {
      // Lazy-load the VAD (and its ort-web) only when dictation first starts.
      const { MicVAD } = await import("@ricky0123/vad-web");
      const vad = await MicVAD.new({
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: VAD_ASSET_PATH,
        model: "v5",
        // Tuned to reject transients (keyboard clicks, short noises) and require
        // a real pause before committing a phrase.
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.4,
        minSpeechMs: 250,
        redemptionMs: 900,
        preSpeechPadMs: 250,
        // Flush the in-progress phrase as a final segment when we pause on stop.
        submitUserSpeechOnPause: true,
        onSpeechStart: () => {
          phraseSeqRef.current += 1;
          activePhraseIdRef.current = phraseSeqRef.current;
          segmentFramesRef.current = [];
          lastInterimAtRef.current = Date.now();
        },
        onFrameProcessed: (_probs, frame) => {
          if (activePhraseIdRef.current === null) return;
          // Copy: the VAD may reuse the frame buffer after this callback.
          segmentFramesRef.current.push(frame.slice());
          const now = Date.now();
          if (now - lastInterimAtRef.current >= INTERIM_INTERVAL_MS) {
            lastInterimAtRef.current = now;
            sendTranscribe(
              concatFrames(segmentFramesRef.current),
              activePhraseIdRef.current,
              false,
            );
          }
        },
        onSpeechEnd: (audio) => {
          const phraseId = activePhraseIdRef.current;
          activePhraseIdRef.current = null;
          segmentFramesRef.current = [];
          if (phraseId === null) return;
          // C2: Guard before incrementing — sendTranscribe may bail on
          // MIN_SAMPLES, and an un-drained pendingFinals count permanently
          // sticks the UI at "transcribing".
          if (audio.length < MIN_SAMPLES) return;
          pendingFinalsRef.current += 1;
          // W2: VAD's onSpeechEnd allocates a fresh Float32Array per event,
          // so transfer directly without a redundant .slice() copy.
          sendTranscribe(audio, phraseId, true);
        },
        onVADMisfire: () => {
          // Too short to be speech — discard the blip and any interim it showed.
          activePhraseIdRef.current = null;
          segmentFramesRef.current = [];
          interimRef.current = "";
          emit();
        },
      });
      vadRef.current = vad;
      // Build the worker now so its transformers chunk is fetched while the user
      // starts speaking; the model loads lazily on the first pass.
      ensureWorker();
      await vad.start();
      setStatus("recording");
    } catch (err) {
      setStatus("idle");
      const msg =
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "NotFoundError")
          ? "Microphone unavailable — check the app's mic permission."
          : `Dictation failed to start: ${err instanceof Error ? err.message : String(err)}`;
      report(msg, { severity: "warn" });
    } finally {
      startingRef.current = false;
    }
  }, [emit, ensureWorker, report, sendTranscribe]);

  const stop = useCallback(async (): Promise<void> => {
    stoppingRef.current = true;
    const vad = vadRef.current;
    vadRef.current = null;
    // pause() with submitUserSpeechOnPause flushes the in-progress phrase via
    // onSpeechEnd (→ a final pass) before we tear the VAD down.
    try {
      await vad?.pause();
    } catch {
      /* ignore — we're tearing down anyway */
    }
    try {
      await vad?.destroy();
    } catch {
      /* ignore */
    }
    if (pendingFinalsRef.current > 0) {
      setStatus("transcribing");
    } else {
      stoppingRef.current = false;
      setStatus("idle");
    }
  }, []);

  const toggle = useCallback((): void => {
    if (!supported) return;
    if (status === "recording") {
      void stop();
    } else if (status === "idle") {
      void start();
    }
    // "requesting"/"transcribing" are transient — ignore extra clicks.
  }, [supported, status, start, stop]);

  // Single teardown for every imperative resource the hook holds open.
  useMountEffect(() => () => {
    void vadRef.current?.destroy();
    workerRef.current?.terminate();
  });

  return {
    supported,
    status,
    isRecording: status === "recording",
    modelProgress,
    toggle,
  };
}
