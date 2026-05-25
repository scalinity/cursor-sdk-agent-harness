import { useCallback, useRef, useState } from "react";
import type { DocsSource, AddDocsSourceRequest } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
import { useMountEffect } from "./useMountEffect.js";

export interface UseDocsSourcesResult {
  sources: DocsSource[];
  loading: boolean;
  error: string | null;
  addSource: (req: AddDocsSourceRequest) => Promise<DocsSource>;
  deleteSource: (id: string) => Promise<void>;
  recrawlSource: (id: string) => Promise<void>;
  reload: () => void;
}

export function useDocsSources(): UseDocsSourcesResult {
  const [sources, setSources] = useState<DocsSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mutate = useMutatingRequest();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await httpRequest("/api/docs/sources");
      setSources(data as unknown as DocsSource[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load docs sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useMountEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  });

  const addSource = useCallback(
    async (req: AddDocsSourceRequest): Promise<DocsSource> => {
      const data = await mutate("/api/docs/sources", {
        method: "POST",
        body: req,
      });
      const source = data as unknown as DocsSource;
      setSources((prev) => [source, ...prev]);
      return source;
    },
    [mutate],
  );

  const deleteSource = useCallback(
    async (id: string): Promise<void> => {
      await mutate(`/api/docs/sources/${id}`, { method: "DELETE" });
      setSources((prev) => prev.filter((s) => s.id !== id));
    },
    [mutate],
  );

  const recrawlSource = useCallback(
    async (id: string): Promise<void> => {
      await mutate(`/api/docs/sources/${id}/recrawl`, { method: "POST" });
      void load();
    },
    [mutate, load],
  );

  return { sources, loading, error, addSource, deleteSource, recrawlSource, reload: load };
}
