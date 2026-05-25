import { useCallback, useState } from "react";
import type {
  AddProviderRequest,
  ModelProviderSummary,
  TestProviderResponse,
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
import { useMountEffect } from "./useMountEffect.js";

export interface UseProvidersResult {
  providers: ModelProviderSummary[];
  loading: boolean;
  error: string | null;
  addProvider: (req: AddProviderRequest) => Promise<ModelProviderSummary>;
  deleteProvider: (id: string) => Promise<void>;
  testProvider: (id: string) => Promise<TestProviderResponse>;
  reload: () => void;
}

/** Phase 23 — BYOK provider registry CRUD (keys never round-trip the client). */
export function useProviders(): UseProvidersResult {
  const mutate = useMutatingRequest();
  const [providers, setProviders] = useState<ModelProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await httpRequest("/api/providers");
      setProviders((data as { items: ModelProviderSummary[] }).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useMountEffect(() => {
    void load();
  });

  const addProvider = useCallback(
    async (req: AddProviderRequest): Promise<ModelProviderSummary> => {
      const data = await mutate("/api/providers", { method: "POST", body: req });
      const created = data as unknown as ModelProviderSummary;
      setProviders((prev) => [...prev, created]);
      return created;
    },
    [mutate],
  );

  const deleteProvider = useCallback(
    async (id: string): Promise<void> => {
      await mutate(`/api/providers/${id}`, { method: "DELETE" });
      setProviders((prev) => prev.filter((p) => p.id !== id));
    },
    [mutate],
  );

  const testProvider = useCallback(
    async (id: string): Promise<TestProviderResponse> => {
      const data = await mutate(`/api/providers/${id}/test`, { method: "POST" });
      return data as unknown as TestProviderResponse;
    },
    [mutate],
  );

  return {
    providers,
    loading,
    error,
    addProvider,
    deleteProvider,
    testProvider,
    reload: () => void load(),
  };
}
