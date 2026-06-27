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
import { httpRequest } from "../lib/http-client.js";
import { useSettingsStore } from "../state/settings-store.js";
import { useMutatingRequest } from "./useMutatingRequest.js";

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
  const mutate = useMutatingRequest();

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
        const next = await mutate("/api/settings", {
          method: "PATCH",
          body: patch,
          responseSchema: settingsSnapshotSchema,
        });
        if (mutationId === settingsMutationSeq) setSnapshot(next);
      } catch (e) {
        if (mutationId === settingsMutationSeq) setLastError(errorMessage("settings", e));
        throw e;
      }
    },
    [mutate, setSnapshot, setLastError],
  );

  const updatePricing = useCallback(
    async (patch: UpdatePricingRequest) => {
      const mutationId = ++settingsMutationSeq;
      setLastError(null);
      try {
        const next = await mutate("/api/settings/pricing", {
          method: "PATCH",
          body: patch,
          responseSchema: settingsSnapshotSchema,
        });
        if (mutationId === settingsMutationSeq) setSnapshot(next);
      } catch (e) {
        if (mutationId === settingsMutationSeq) setLastError(errorMessage("pricing", e));
        throw e;
      }
    },
    [mutate, setSnapshot, setLastError],
  );

  const setApiKey = useCallback(
    async (value: string) => {
      const next = await mutate("/api/settings/api-key", {
        method: "PUT",
        body: { value },
        responseSchema: apiKeyPresenceResponseSchema,
      });
      setApiKeyPresence(next.present, next.lastValidatedAt ?? null);
    },
    [mutate, setApiKeyPresence],
  );

  const deleteApiKey = useCallback(async () => {
    const next = await mutate("/api/settings/api-key", {
      method: "DELETE",
      responseSchema: apiKeyPresenceResponseSchema,
    });
    setApiKeyPresence(next.present, next.lastValidatedAt ?? null);
  }, [mutate, setApiKeyPresence]);

  return { reload, updateSettings, updatePricing, setApiKey, deleteApiKey };
}

/** Trigger a one-time bootstrap reload unless a snapshot is already loaded. */
function useBootstrapReload(reload: () => Promise<void>): void {
  const snapshot = useSettingsStore((s) => s.snapshot);
  useEffect(() => {
    if (snapshot) return;
    void reload();
  }, [snapshot, reload]);
}

export function useSettingsBootstrap(): void {
  const { reload } = useSettingsActions();
  useBootstrapReload(reload);
}

export function useSettings(): UseSettingsResult {
  const snapshot = useSettingsStore((s) => s.snapshot);
  const apiKeyPresent = useSettingsStore((s) => s.apiKeyPresent);
  const loading = useSettingsStore((s) => s.loading);
  const lastError = useSettingsStore((s) => s.lastError);
  const actions = useSettingsActions();
  useBootstrapReload(actions.reload);

  return {
    snapshot,
    apiKeyPresent,
    loading,
    error: lastError,
    ...actions,
  };
}
