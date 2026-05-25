import { useCallback, useState } from "react";
import { listModelsResponseSchema, type UnifiedModel } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useMountEffect } from "./useMountEffect.js";

export interface UseModelsResult {
  models: UnifiedModel[];
  autoAvailable: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Phase 23 — unified model list across all providers (Cursor + BYOK).
 * Used by the model selector to group models by provider and gate modes.
 */
export function useModels(): UseModelsResult {
  const [models, setModels] = useState<UnifiedModel[]>([]);
  const [autoAvailable, setAutoAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await httpRequest("/api/models", {
        responseSchema: listModelsResponseSchema,
      });
      setModels(data.items);
      setAutoAvailable(data.autoAvailable);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useMountEffect(() => {
    void load();
  });

  return { models, autoAvailable, loading, error, reload: () => void load() };
}
