/**
 * useSettings — wraps `/api/settings` and `/api/settings/api-key`.
 * The bootstrap fetch is deduped across consumers; mutation helpers sequence
 * full-snapshot responses so stale requests cannot overwrite newer settings.
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

export type UseSettingsActions = Pick<
  UseSettingsResult,
  "reload" | "updateSettings" | "updatePricing" | "setApiKey" | "deleteApiKey"
>;

let reloadInFlight: Promise<void> | null = null;
let settingsMutationSeq = 0;

function errorMessage(prefix: string, value: unknown): string {
  return value instanceof Error ? `${prefix}: ${value.message}` : `${prefix}: request failed`;
}

export function useSettingsActions(): UseSettingsActions {
  const setSnapshot = useSettingsStore((s) => s.setSnapshot);
  const setApiKeyPresence = useSettingsStore((s) => s.setApiKeyPresence);
  const setLoading = useSettingsStore((s) => s.setLoading);
  const setLastError = useSettingsStore((s) => s.setLastError);
  const { refresh: refreshCsrfToken } = useCsrfToken();

  const reload = useCallback(async () => {
    if (reloadInFlight) return reloadInFlight;
    const promise = (async () => {
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
        errors.push(errorMessage("settings", snapResult.reason));
      }
      if (keyResult.status === "fulfilled") {
        setApiKeyPresence(keyResult.value.present, keyResult.value.lastValidatedAt ?? null);
      } else {
        errors.push(errorMessage("api-key", keyResult.reason));
      }
      setLastError(errors.length > 0 ? errors.join("; ") : null);
      setLoading(false);
    })().finally(() => {
      reloadInFlight = null;
    });
    reloadInFlight = promise;
    return promise;
  }, [setSnapshot, setApiKeyPresence, setLoading, setLastError]);

  const updateSettings = useCallback(
    async (patch: UpdateSettingsRequest) => {
      const mutationId = ++settingsMutationSeq;
      setLastError(null);
      try {
        const next = await mutatingRequest("/api/settings", {
          method: "PATCH",
          body: patch,
          getCsrfToken: () => useUiStore.getState().csrfToken,
          refreshCsrfToken,
          responseSchema: settingsSnapshotSchema,
        });
        if (mutationId === settingsMutationSeq) setSnapshot(next);
      } catch (e) {
        if (mutationId === settingsMutationSeq) setLastError(errorMessage("settings", e));
        throw e;
      }
    },
    [refreshCsrfToken, setSnapshot, setLastError],
  );

  const updatePricing = useCallback(
    async (patch: UpdatePricingRequest) => {
      const mutationId = ++settingsMutationSeq;
      setLastError(null);
      try {
        const next = await mutatingRequest("/api/settings/pricing", {
          method: "PATCH",
          body: patch,
          getCsrfToken: () => useUiStore.getState().csrfToken,
          refreshCsrfToken,
          responseSchema: settingsSnapshotSchema,
        });
        if (mutationId === settingsMutationSeq) setSnapshot(next);
      } catch (e) {
        if (mutationId === settingsMutationSeq) setLastError(errorMessage("pricing", e));
        throw e;
      }
    },
    [refreshCsrfToken, setSnapshot, setLastError],
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

  return { reload, updateSettings, updatePricing, setApiKey, deleteApiKey };
}

export function useSettingsBootstrap(): void {
  const snapshot = useSettingsStore((s) => s.snapshot);
  const actions = useSettingsActions();
  const { reload } = actions;

  useEffect(() => {
    if (snapshot) return;
    void reload();
  }, [snapshot, reload]);
}

export function useSettings(): UseSettingsResult {
  const snapshot = useSettingsStore((s) => s.snapshot);
  const apiKeyPresent = useSettingsStore((s) => s.apiKeyPresent);
  const loading = useSettingsStore((s) => s.loading);
  const lastError = useSettingsStore((s) => s.lastError);
  const actions = useSettingsActions();
  const { reload } = actions;

  useEffect(() => {
    if (snapshot) return;
    void reload();
  }, [snapshot, reload]);

  return {
    snapshot,
    apiKeyPresent,
    loading,
    error: lastError,
    ...actions,
  };
}
