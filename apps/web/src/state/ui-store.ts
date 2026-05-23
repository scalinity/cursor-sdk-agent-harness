/**
 * UI store — non-domain state that is purely client-side. Holds:
 *   - CSRF token (loaded once at app bootstrap, used by http + WS layers)
 *   - Code-pane visibility (⌘J toggles)
 *   - WebSocket connection state (for the connection banner)
 *   - Composer draft (so the textarea is controlled but state stays out of components)
 *   - A simple toast queue (used by `useErrorReporter`)
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
}

export interface UiState {
  codeHidden: boolean;
  csrfToken: string | null;
  connectionState: ConnectionState;
  composerDraft: string;
  toasts: Toast[];

  setCodeHidden: (hidden: boolean) => void;
  toggleCodeHidden: () => void;
  setCsrfToken: (token: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setComposerDraft: (draft: string) => void;
  pushToast: (toast: Omit<Toast, "id" | "createdAt">) => void;
  dismissToast: (id: string) => void;
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

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  codeHidden: readInitialCodeHidden(),
  csrfToken: null,
  connectionState: "idle",
  composerDraft: "",
  toasts: [],

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
  pushToast: ({ scope, message, severity }) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        {
          id: `toast-${++toastCounter}`,
          scope,
          message,
          severity,
          createdAt: new Date().toISOString(),
        },
      ],
    })),
  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}));
