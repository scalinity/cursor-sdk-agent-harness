/**
 * useSettings — wraps `/api/settings` and `/api/settings/api-key`.
 * The fetch fires once on mount; callers re-run via `reload()`.
 */
import { useCallback, useEffect } from "react";
import {
  apiKeyPresenceResponseSchema,
  settingsSnapshotSchema,
  type SettingsSnapshot,
  type UpdateSettingsRequest,
  type UpdatePricingRequest,
} from "@harness/shared";
import { httpRequest, mutatingRequest } from "../lib/http-client.js";
import { useSettingsStore } from "../state/settings-store.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";

export interface UseSettingsResult {
  snapshot: SettingsSnapshot | null;
  apiKeyPresent: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  updateSettings: (patch: UpdateSettingsRequest) => Promise<void>;
  updatePricing: (patch: UpdatePricingRequest) => Promise<void>;
  setApiKey: (value: string) => Promise<void>;
  deleteApiKey: () => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const snapshot = useSettingsStore((s) => s.snapshot);
  const apiKeyPresent = useSettingsStore((s) => s.apiKeyPresent);
  const loading = useSettingsStore((s) => s.loading);
  const lastError = useSettingsStore((s) => s.lastError);
  const setSnapshot = useSettingsStore((s) => s.setSnapshot);
  const setApiKeyPresence = useSettingsStore((s) => s.setApiKeyPresence);
  const setLoading = useSettingsStore((s) => s.setLoading);
  const setLastError = useSettingsStore((s) => s.setLastError);
  const { refresh: refreshCsrfToken } = useCsrfToken();

  const reload = useCallback(async () => {
    setLoading(true);
    setLastError(null);
    // Use allSettled so a transient failure in one endpoint doesn't block
    // the other from hydrating (RV2-W14). The two endpoints are independent
    // — settings snapshot and api-key presence — and the UI degrades better
    // when at least one half is populated.
    const [snapResult, keyResult] = await Promise.allSettled([
      httpRequest("/api/settings", { responseSchema: settingsSnapshotSchema }),
      httpRequest("/api/settings/api-key", { responseSchema: apiKeyPresenceResponseSchema }),
    ]);
    const errors: string[] = [];
    if (snapResult.status === "fulfilled") {
      setSnapshot(snapResult.value);
    } else {
      errors.push(
        snapResult.reason instanceof Error
          ? `settings: ${snapResult.reason.message}`
          : `settings: load failed`,
      );
    }
    if (keyResult.status === "fulfilled") {
      setApiKeyPresence(keyResult.value.present, keyResult.value.lastValidatedAt ?? null);
    } else {
      errors.push(
        keyResult.reason instanceof Error
          ? `api-key: ${keyResult.reason.message}`
          : `api-key: load failed`,
      );
    }
    setLastError(errors.length > 0 ? errors.join("; ") : null);
    setLoading(false);
  }, [setSnapshot, setApiKeyPresence, setLoading, setLastError]);

  const updateSettings = useCallback(
    async (patch: UpdateSettingsRequest) => {
      const next = await mutatingRequest("/api/settings", {
        method: "PATCH",
        body: patch,
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: settingsSnapshotSchema,
      });
      setSnapshot(next);
    },
    [refreshCsrfToken, setSnapshot],
  );

  const updatePricing = useCallback(
    async (patch: UpdatePricingRequest) => {
      const next = await mutatingRequest("/api/settings/pricing", {
        method: "PATCH",
        body: patch,
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: settingsSnapshotSchema,
      });
      setSnapshot(next);
    },
    [refreshCsrfToken, setSnapshot],
  );

  const setApiKey = useCallback(
    async (value: string) => {
      const next = await mutatingRequest("/api/settings/api-key", {
        method: "PUT",
        body: { value },
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: apiKeyPresenceResponseSchema,
      });
      setApiKeyPresence(next.present, next.lastValidatedAt ?? null);
    },
    [refreshCsrfToken, setApiKeyPresence],
  );

  const deleteApiKey = useCallback(async () => {
    const next = await mutatingRequest("/api/settings/api-key", {
      method: "DELETE",
      getCsrfToken: () => useUiStore.getState().csrfToken,
      refreshCsrfToken,
      responseSchema: apiKeyPresenceResponseSchema,
    });
    setApiKeyPresence(next.present, next.lastValidatedAt ?? null);
  }, [refreshCsrfToken, setApiKeyPresence]);

  useEffect(() => {
    if (snapshot) return;
    void reload();
  }, [snapshot, reload]);

  return {
    snapshot,
    apiKeyPresent,
    loading,
    error: lastError,
    reload,
    updateSettings,
    updatePricing,
    setApiKey,
    deleteApiKey,
  };
}
