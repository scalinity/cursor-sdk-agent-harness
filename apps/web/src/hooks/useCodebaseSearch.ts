import { useCallback, useRef, useState } from "react";
import {
  fileSearchResultSchema,
  grepSearchResultSchema,
  semanticSearchResultSchema,
  type GrepSearchResult,
  type FileSearchResult,
  type SemanticSearchResult,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMountEffect } from "./useMountEffect.js";

export type SearchType = "grep" | "files" | "semantic";

export interface UseCodebaseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  searchType: SearchType;
  setSearchType: (t: SearchType) => void;
  grepResults: GrepSearchResult | null;
  fileResults: FileSearchResult | null;
  semanticResults: SemanticSearchResult | null;
  isSearching: boolean;
  error: string | null;
}

export function useCodebaseSearch(): UseCodebaseSearchResult {
  const [query, setQueryState] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("grep");
  const [grepResults, setGrepResults] = useState<GrepSearchResult | null>(null);
  const [fileResults, setFileResults] = useState<FileSearchResult | null>(null);
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const clearResults = useCallback(() => {
    setGrepResults(null);
    setFileResults(null);
    setSemanticResults(null);
  }, []);

  const abortActiveSearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestSeqRef.current += 1;
  }, []);

  const doSearch = useCallback(async (q: string, type: SearchType) => {
    if (q.length === 0) {
      abortActiveSearch();
      clearResults();
      setError(null);
      setIsSearching(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestSeqRef.current;
    const isCurrent = () => requestSeqRef.current === requestId && !controller.signal.aborted;

    setIsSearching(true);
    setError(null);
    try {
      if (type === "grep") {
        const data = await httpRequest("/api/search/grep", {
          query: { q },
          signal: controller.signal,
          responseSchema: grepSearchResultSchema,
        });
        if (!isCurrent()) return;
        setGrepResults(data);
        setFileResults(null);
        setSemanticResults(null);
      } else if (type === "files") {
        const data = await httpRequest("/api/search/files", {
          query: { pattern: q },
          signal: controller.signal,
          responseSchema: fileSearchResultSchema,
        });
        if (!isCurrent()) return;
        setFileResults(data);
        setGrepResults(null);
        setSemanticResults(null);
      } else {
        const data = await httpRequest("/api/search/semantic", {
          query: { q },
          signal: controller.signal,
          responseSchema: semanticSearchResultSchema,
        });
        if (!isCurrent()) return;
        setSemanticResults(data);
        setGrepResults(null);
        setFileResults(null);
      }
    } catch (e) {
      if (!isCurrent()) return;
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        setIsSearching(false);
      }
    }
  }, [abortActiveSearch, clearResults]);

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.length === 0) {
        abortActiveSearch();
        clearResults();
        setError(null);
        setIsSearching(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        void doSearch(q, searchType);
      }, 300);
    },
    [abortActiveSearch, clearResults, doSearch, searchType],
  );

  useMountEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortActiveSearch();
    };
  });

  const changeSearchType = useCallback(
    (t: SearchType) => {
      setSearchType(t);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (query.length > 0) {
        void doSearch(query, t);
      } else {
        abortActiveSearch();
        clearResults();
        setError(null);
      }
    },
    [abortActiveSearch, clearResults, doSearch, query],
  );

  return {
    query,
    setQuery,
    searchType,
    setSearchType: changeSearchType,
    grepResults,
    fileResults,
    semanticResults,
    isSearching,
    error,
  };
}
