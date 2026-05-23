/**
 * Usage store — stub for Phase 11. Exposes the typed shape so consumers can
 * subscribe; the data hydration lives in `useUsage` (Phase 11).
 */
import type { UsageSource } from "@harness/shared";
import { create } from "zustand";

export interface UsageSummary {
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalReasoningTokens: number;
  totalCostUsdMicros: number;
  bySource: Partial<Record<UsageSource, number>>;
}

export interface UsageState {
  summary: UsageSummary | null;
  loading: boolean;
  lastError: string | null;

  setSummary: (summary: UsageSummary) => void;
  setLoading: (loading: boolean) => void;
  setLastError: (msg: string | null) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  summary: null,
  loading: false,
  lastError: null,

  setSummary: (summary) => set({ summary }),
  setLoading: (loading) => set({ loading }),
  setLastError: (msg) => set({ lastError: msg }),
}));
