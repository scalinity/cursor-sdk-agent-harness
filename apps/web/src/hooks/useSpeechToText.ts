/**
 * useSpeechToText — push-to-talk dictation for the composer, transcribed
 * fully on-device by a Whisper model running in `whisper-worker.ts`.
 *
 * Why a hook (and not inline in the component): it owns three pieces of
 * imperative, non-React state — a `MediaStream`, a `MediaRecorder`, and the
 * Whisper `Worker` — plus their teardown. Per the repo's effects policy those
 * belong in a hook, where a single `useMountEffect` cleanup tears everything
 * down on unmount.
 *
 * The pipeline, on stop: MediaRecorder chunks → Blob → decode + resample to
 * mono 16 kHz Float32 (what Whisper wants) → transfer to the worker → text.
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
  /** Called once per completed transcription with the recognized text. */
  onTranscript: (text: string) => void;
}

export interface SpeechToText {
  /** False where the browser APIs are missing (e.g. jsdom). */
  readonly supported: boolean;
  readonly status: SpeechToTextStatus;
  readonly isRecording: boolean;
  /** 0–100 while the model downloads on first use; null otherwise. */
  readonly modelProgress: number | null;
  /** Start recording when idle, stop+transcribe when recording. */
  readonly toggle: () => void;
}

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

export function useSpeechToText({ onTranscript }: UseSpeechToTextOptions): SpeechToText {
  const supported = detectSupport();
  const [status, setStatus] = useState<SpeechToTextStatus>("idle");
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const { report } = useErrorReporter("speech-to-text");

  // Keep the latest callback without re-subscribing the worker each render.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("./whisper-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<WhisperResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        setModelProgress(Math.round(msg.progress));
        return;
      }
      setModelProgress(null);
      setStatus("idle");
      if (msg.type === "result") {
        const text = msg.text.trim();
        if (text.length > 0) onTranscriptRef.current(text);
      } else {
        report(`Transcription failed: ${msg.message}`, { severity: "warn" });
      }
    });
    workerRef.current = worker;
    return worker;
  }, [report]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

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
      // Ignore sub-0.1s blips (accidental tap) — nothing meaningful to send.
      if (audio.length < 1600) {
        setStatus("idle");
        return;
      }
      ensureWorker().postMessage(
        { type: "transcribe", audio } satisfies WhisperTranscribeRequest,
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
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener("stop", () => void finalize());
    recorder.start();
    setStatus("recording");
  }, [finalize, report]);

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
