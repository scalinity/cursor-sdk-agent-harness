import { useCallback, useRef, useState } from "react";
import type { GrepSearchResult, FileSearchResult } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMountEffect } from "./useMountEffect.js";

export type SearchType = "grep" | "files";

export interface UseCodebaseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  searchType: SearchType;
  setSearchType: (t: SearchType) => void;
  grepResults: GrepSearchResult | null;
  fileResults: FileSearchResult | null;
  isSearching: boolean;
  error: string | null;
}

export function useCodebaseSearch(): UseCodebaseSearchResult {
  const [query, setQueryState] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("grep");
  const [grepResults, setGrepResults] = useState<GrepSearchResult | null>(null);
  const [fileResults, setFileResults] = useState<FileSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (q: string, type: SearchType) => {
      if (q.length === 0) {
        setGrepResults(null);
        setFileResults(null);
        return;
      }
      setIsSearching(true);
      setError(null);
      try {
        if (type === "grep") {
          const data = await httpRequest(
            "/api/search/grep",
            { query: { q } },
          );
          setGrepResults(data as unknown as GrepSearchResult);
          setFileResults(null);
        } else {
          const data = await httpRequest(
            "/api/search/files",
            { query: { pattern: q } },
          );
          setFileResults(data as unknown as FileSearchResult);
          setGrepResults(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setIsSearching(false);
      }
    },
    [],
  );

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void doSearch(q, searchType);
      }, 300);
    },
    [doSearch, searchType],
  );

  useMountEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  });

  const changeSearchType = useCallback(
    (t: SearchType) => {
      setSearchType(t);
      if (query.length > 0) {
        void doSearch(query, t);
      }
    },
    [doSearch, query],
  );

  return {
    query,
    setQuery,
    searchType,
    setSearchType: changeSearchType,
    grepResults,
    fileResults,
    isSearching,
    error,
  };
}
