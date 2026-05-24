import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { eventLargePayloadResponseSchema, eventPayloadResponseSchema } from "@harness/shared";
import { useErrorReporter } from "./useErrorReporter.js";
import { apiUrl } from "../lib/api-base.js";

export interface LargePayloadRef {
  url: string;
  byteCount?: number | undefined;
}

export interface UseLazyPayloadResult {
  value: unknown;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

function getMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeUrl(ref: LargePayloadRef | null): string | null {
  if (!ref) return null;
  const url = new URL(ref.url, window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error("Payload URL must be same-origin.");
  }
  if (!url.pathname.startsWith("/api/events/")) {
    throw new Error("Payload URL must target the events API.");
  }
  return `${url.pathname}${url.search}`;
}

export function useLazyPayload(ref: LargePayloadRef | null): UseLazyPayloadResult {
  const refKey = useMemo(() => (ref ? `${ref.url}:${ref.byteCount ?? "unknown"}` : "none"), [ref]);
  const url = useMemo(() => normalizeUrl(ref), [ref]);
  const [value, setValue] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const { report } = useErrorReporter("lazy-payload");

  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setValue(null);
    setLoaded(false);
    setLoading(false);
    setError(null);
  }, [refKey]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const load = useCallback(async () => {
    if (!url || loading || loaded) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(url), { signal: controller.signal });
      if (!res.ok) throw new Error(`Payload fetch failed with ${res.status}`);
      const raw = await res.json();
      const parsed = url.includes("/large-payload/")
        ? eventLargePayloadResponseSchema.parse(raw)
        : eventPayloadResponseSchema.parse(raw);
      if (generationRef.current !== generation) return;
      setValue(parsed.value);
      setLoaded(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (generationRef.current !== generation) return;
      const message = getMessage(err);
      setError(message);
      report(err);
    } finally {
      window.clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
      if (generationRef.current === generation) setLoading(false);
    }
  }, [loaded, loading, report, url]);

  return { value, loaded, loading, error, load };
}
