/**
 * useRunSearch — debounced full-text search over runs via
 * `GET /api/runs/search?q=...`. Activates when the query is at least 2
 * characters; shorter queries return an empty result set.
 *
 * useEffect is allowed in hooks per CLAUDE.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { runSearchResultSchema, type RunSearchResult } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

type SearchResults = RunSearchResult["results"];

export interface UseRunSearchResult {
  results: SearchResults;
  isSearching: boolean;
  error: string | null;
}

export function useRunSearch(query: string): UseRunSearchResult {
  const [results, setResults] = useState<SearchResults>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string) => {
    // Abort any in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setError(null);
    try {
      const res = await httpRequest("/api/runs/search", {
        query: { q },
        responseSchema: runSearchResultSchema,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setResults(res.results);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    // Clear any pending timer.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (query.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsSearching(false);
      setError(null);
      abortRef.current?.abort();
      return;
    }

    timerRef.current = setTimeout(() => {
      void doSearch(query);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [query, doSearch]);

  // Cleanup abort on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { results, isSearching, error };
}
