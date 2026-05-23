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
} from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useSettingsStore } from "../state/settings-store.js";
import { useUiStore } from "../state/ui-store.js";

export interface UseSettingsResult {
  snapshot: SettingsSnapshot | null;
  apiKeyPresent: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  updateSettings: (patch: UpdateSettingsRequest) => Promise<void>;
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
  const csrfToken = useUiStore((s) => s.csrfToken);

  const reload = useCallback(async () => {
    setLoading(true);
    setLastError(null);
    try {
      const [snap, keyPresence] = await Promise.all([
        httpRequest("/api/settings", { responseSchema: settingsSnapshotSchema }),
        httpRequest("/api/settings/api-key", { responseSchema: apiKeyPresenceResponseSchema }),
      ]);
      setSnapshot(snap);
      setApiKeyPresence(keyPresence.present, keyPresence.lastValidatedAt ?? null);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "settings load failed");
    } finally {
      setLoading(false);
    }
  }, [setSnapshot, setApiKeyPresence, setLoading, setLastError]);

  const updateSettings = useCallback(
    async (patch: UpdateSettingsRequest) => {
      const next = await httpRequest("/api/settings", {
        method: "PATCH",
        body: patch,
        csrfToken,
        responseSchema: settingsSnapshotSchema,
      });
      setSnapshot(next);
    },
    [csrfToken, setSnapshot],
  );

  const setApiKey = useCallback(
    async (value: string) => {
      const next = await httpRequest("/api/settings/api-key", {
        method: "PUT",
        body: { value },
        csrfToken,
        responseSchema: apiKeyPresenceResponseSchema,
      });
      setApiKeyPresence(next.present, next.lastValidatedAt ?? null);
    },
    [csrfToken, setApiKeyPresence],
  );

  const deleteApiKey = useCallback(async () => {
    const next = await httpRequest("/api/settings/api-key", {
      method: "DELETE",
      csrfToken,
      responseSchema: apiKeyPresenceResponseSchema,
    });
    setApiKeyPresence(next.present, next.lastValidatedAt ?? null);
  }, [csrfToken, setApiKeyPresence]);

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
    setApiKey,
    deleteApiKey,
  };
}
