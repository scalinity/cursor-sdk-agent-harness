/**
 * Settings store — caches the server settings snapshot and API-key presence.
 * The components consume slices; `useSettings` is the only writer.
 */
import type { ModelId, SettingsSnapshot } from "@harness/shared";
import { create } from "zustand";

export interface SettingsState {
  snapshot: SettingsSnapshot | null;
  apiKeyPresent: boolean;
  apiKeyLastValidatedAt: string | null;
  defaultModelId: ModelId | null;
  loading: boolean;
  lastError: string | null;

  setSnapshot: (snapshot: SettingsSnapshot) => void;
  setApiKeyPresence: (present: boolean, lastValidatedAt?: string | null) => void;
  setLoading: (loading: boolean) => void;
  setLastError: (msg: string | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  snapshot: null,
  apiKeyPresent: false,
  apiKeyLastValidatedAt: null,
  defaultModelId: null,
  loading: false,
  lastError: null,

  setSnapshot: (snapshot) =>
    set({
      snapshot,
      defaultModelId: snapshot.defaultModelId,
    }),
  setApiKeyPresence: (present, lastValidatedAt) =>
    set({
      apiKeyPresent: present,
      apiKeyLastValidatedAt: lastValidatedAt ?? null,
    }),
  setLoading: (loading) => set({ loading }),
  setLastError: (msg) => set({ lastError: msg }),
}));
