/**
 * UI store — non-domain state that is purely client-side. Holds:
 *   - CSRF token (loaded once at app bootstrap, used by http + WS layers)
 *   - Code-pane visibility (⌘J toggles)
 *   - WebSocket connection state (for the connection banner)
 *   - Composer draft (so the textarea is controlled but state stays out of components)
 *   - A simple toast queue (used by `useErrorReporter`) with per-toast TTL
 */
import { create } from "zustand";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

export interface Toast {
  id: string;
  scope: string;
  message: string;
  severity: "info" | "warn" | "error";
  createdAt: string;
  /** Epoch ms at which the sweeper should auto-dismiss. null = sticky. */
  expiresAt: number | null;
}

const DEFAULT_TOAST_TTL_MS_BY_SEVERITY: Record<Toast["severity"], number | null> = {
  info: 4_000,
  warn: 7_000,
  error: 12_000,
};

export interface UiState {
  codeHidden: boolean;
  csrfToken: string | null;
  connectionState: ConnectionState;
  composerDraft: string;
  toasts: Toast[];
  /**
   * Monotonic counter for toast IDs. Lives on the store rather than at
   * module scope so test resets (`useUiStore.setState`) start from zero
   * and IDs never collide across mounted instances.
   */
  toastCounter: number;

  setCodeHidden: (hidden: boolean) => void;
  toggleCodeHidden: () => void;
  setCsrfToken: (token: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setComposerDraft: (draft: string) => void;
  pushToast: (toast: Omit<Toast, "id" | "createdAt" | "expiresAt"> & { ttlMs?: number | null }) => void;
  dismissToast: (id: string) => void;
  sweepExpiredToasts: (now?: number) => void;
}

const CODE_HIDDEN_STORAGE_KEY = "harness:codeHidden";

function readInitialCodeHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CODE_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCodeHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CODE_HIDDEN_STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // Storage unavailable (private mode) — silently ignore.
  }
}

export const useUiStore = create<UiState>((set) => ({
  codeHidden: readInitialCodeHidden(),
  csrfToken: null,
  connectionState: "idle",
  composerDraft: "",
  toasts: [],
  toastCounter: 0,

  setCodeHidden: (hidden) => {
    persistCodeHidden(hidden);
    set({ codeHidden: hidden });
  },
  toggleCodeHidden: () => {
    set((s) => {
      const next = !s.codeHidden;
      persistCodeHidden(next);
      return { codeHidden: next };
    });
  },
  setCsrfToken: (token) => set({ csrfToken: token }),
  setConnectionState: (state) => set({ connectionState: state }),
  setComposerDraft: (draft) => set({ composerDraft: draft }),
  pushToast: ({ scope, message, severity, ttlMs }) =>
    set((s) => {
      const nextId = s.toastCounter + 1;
      const defaultTtl = DEFAULT_TOAST_TTL_MS_BY_SEVERITY[severity];
      const effectiveTtl = ttlMs === undefined ? defaultTtl : ttlMs;
      return {
        toastCounter: nextId,
        toasts: [
          ...s.toasts,
          {
            id: `toast-${nextId}`,
            scope,
            message,
            severity,
            createdAt: new Date().toISOString(),
            expiresAt: effectiveTtl === null ? null : Date.now() + effectiveTtl,
          },
        ],
      };
    }),
  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
  sweepExpiredToasts: (now = Date.now()) =>
    set((s) => {
      const survivors = s.toasts.filter((t) => t.expiresAt === null || t.expiresAt > now);
      if (survivors.length === s.toasts.length) return s;
      return { toasts: survivors };
    }),
}));
