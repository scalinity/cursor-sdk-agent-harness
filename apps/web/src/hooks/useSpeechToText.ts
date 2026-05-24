/**
 * useSpeechToText — live, on-device dictation for the composer. A Whisper model
 * in `whisper-worker.ts` transcribes the microphone as the user speaks: the
 * take is re-transcribed on a short cadence so words land in the composer live,
 * then a final pass on stop commits the authoritative transcript.
 *
 * Why a hook (and not inline in the component): it owns four pieces of
 * imperative, non-React state — a `MediaStream`, a `MediaRecorder`, the Whisper
 * `Worker`, and the recorded chunks — plus their teardown. Per the repo's
 * effects policy those belong in a hook, where a single `useMountEffect`
 * cleanup tears everything down on unmount.
 *
 * The pipeline, per pass: MediaRecorder chunks (a timeslice flushes one every
 * INTERIM_MS) → cumulative Blob → decode + resample to mono 16 kHz Float32 →
 * transfer to the worker → streamed partial text + a final transcript. Each
 * pass re-transcribes the whole take from the start, so a result *replaces* the
 * dictation region rather than appending — `onInterimTranscript` always carries
 * the latest full take.
 *
 * Feature detection (`supported`) is deliberate: in the packaged Electron app
 * `getUserMedia`/`MediaRecorder`/`Worker` all exist, but under jsdom (tests)
 * they don't, so the hook degrades to an inert, disabled control rather than
 * throwing on construction.
 */
import { useCallback, useRef, useState } from "react";
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
   * Latest transcript of the in-progress take — fired repeatedly while
   * recording (and during the final pass). Replaces the dictation region, since
   * each pass re-transcribes from the start.
   */
  onInterimTranscript: (text: string) => void;
  /** Authoritative transcript once recording stops; commits the dictation. */
  onFinalTranscript: (text: string) => void;
}

export interface SpeechToText {
  /** False where the browser APIs are missing (e.g. jsdom). */
  readonly supported: boolean;
  readonly status: SpeechToTextStatus;
  readonly isRecording: boolean;
  /** 0–100 while the model downloads on first use; null otherwise. */
  readonly modelProgress: number | null;
  /** Start recording when idle, stop+finalize when recording. */
  readonly toggle: () => void;
}

// MediaRecorder timeslice: flush a chunk (and kick an interim transcription)
// roughly once a second. Fast enough to feel live without spamming the worker —
// and the worker coalesces anything that piles up while a pass is running.
const INTERIM_MS = 1000;

// Ignore sub-0.1s audio (an accidental tap) — nothing meaningful to transcribe.
const MIN_SAMPLES = 1600;

function detectSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof AudioContext !== "undefined"
  );
}

/** Decode recorded audio to the mono, 16 kHz Float32 PCM Whisper expects. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  // Passing sampleRate to the context makes decodeAudioData resample for us.
  const audioContext = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    // Copy channel 0 into a standalone buffer so we can transfer (not clone)
    // it to the worker; getChannelData returns a view onto the AudioBuffer.
    return new Float32Array(decoded.getChannelData(0));
  } finally {
    void audioContext.close();
  }
}

/** Map a worker error (which may be raw ONNX Runtime noise) to friendly text. */
function friendlyError(message: string): string {
  if (message.startsWith("model-load:")) {
    return "Couldn't load the voice model — check your connection and try again.";
  }
  return `Dictation failed: ${message}`;
}

export function useSpeechToText({
  onInterimTranscript,
  onFinalTranscript,
}: UseSpeechToTextOptions): SpeechToText {
  const supported = detectSupport();
  const [status, setStatus] = useState<SpeechToTextStatus>("idle");
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const { report } = useErrorReporter("speech-to-text");

  // Keep the latest callbacks without re-subscribing the worker each render.
  const onInterimRef = useRef(onInterimTranscript);
  onInterimRef.current = onInterimTranscript;
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;

  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Guards against overlapping interim decodes (decode is async). The worker
  // already coalesces requests, so skipping a tick here is harmless — the next
  // dataavailable, or the final pass, covers the dropped window.
  const interimDecodingRef = useRef(false);

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
          // Streamed words for the current pass — surface them live.
          onInterimRef.current(msg.text);
          return;
        case "result":
          setModelProgress(null);
          if (msg.final) {
            setStatus("idle");
            if (msg.text.length > 0) onFinalRef.current(msg.text);
          } else {
            // An interim pass settled; recording is still in progress.
            onInterimRef.current(msg.text);
          }
          return;
        case "error":
          setModelProgress(null);
          if (msg.final) setStatus("idle");
          report(friendlyError(msg.message), { severity: "warn" });
          return;
      }
    });
    workerRef.current = worker;
    return worker;
  }, [report]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Re-transcribe the take so far so partial text lands in the composer live.
  const runInterimPass = useCallback(async (): Promise<void> => {
    if (interimDecodingRef.current) return;
    const chunks = chunksRef.current;
    if (chunks.length === 0) return;
    interimDecodingRef.current = true;
    try {
      const type = chunks[0]?.type ?? "audio/webm";
      const audio = await decodeToMono16k(new Blob(chunks, { type }));
      if (audio.length >= MIN_SAMPLES) {
        ensureWorker().postMessage(
          { type: "transcribe", audio, final: false } satisfies WhisperTranscribeRequest,
          [audio.buffer],
        );
      }
    } catch {
      // A cumulative webm blob can fail to decode on a half-written trailing
      // frame; the next tick or the final pass recovers. Don't toast the noise.
    } finally {
      interimDecodingRef.current = false;
    }
  }, [ensureWorker]);

  const finalize = useCallback(async (): Promise<void> => {
    stopTracks();
    const chunks = chunksRef.current;
    chunksRef.current = [];
    recorderRef.current = null;
    if (chunks.length === 0) {
      setStatus("idle");
      return;
    }
    setStatus("transcribing");
    try {
      const type = chunks[0]?.type ?? "audio/webm";
      const audio = await decodeToMono16k(new Blob(chunks, { type }));
      if (audio.length < MIN_SAMPLES) {
        setStatus("idle");
        return;
      }
      ensureWorker().postMessage(
        { type: "transcribe", audio, final: true } satisfies WhisperTranscribeRequest,
        [audio.buffer],
      );
    } catch (err) {
      setStatus("idle");
      report(err, { severity: "warn" });
    }
  }, [ensureWorker, report, stopTracks]);

  const start = useCallback(async (): Promise<void> => {
    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("idle");
      report("Microphone unavailable — check the app's mic permission.", {
        severity: "warn",
      });
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    interimDecodingRef.current = false;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size === 0) return;
      chunksRef.current.push(event.data);
      // Transcribe everything captured so far — but only while recording. The
      // flush that stop() emits arrives with state "inactive"; finalize() owns
      // that buffer so we don't race it with an interim pass.
      if (recorder.state === "recording") void runInterimPass();
    });
    recorder.addEventListener("stop", () => void finalize());
    // A timeslice flushes a chunk every INTERIM_MS, driving the live passes.
    recorder.start(INTERIM_MS);
    // Construct the worker now so its heavy transformers chunk is fetched and
    // parsed while the user speaks; the model itself loads lazily on pass one.
    ensureWorker();
    setStatus("recording");
  }, [ensureWorker, finalize, report, runInterimPass]);

  const toggle = useCallback((): void => {
    if (!supported) return;
    if (status === "recording") {
      recorderRef.current?.stop(); // → "stop" event → finalize()
    } else if (status === "idle") {
      void start();
    }
    // "requesting"/"transcribing" are transient — ignore extra clicks.
  }, [supported, status, start]);

  // Single teardown for every imperative resource the hook holds open.
  useMountEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
