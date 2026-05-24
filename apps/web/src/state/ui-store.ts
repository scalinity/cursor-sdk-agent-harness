/**
 * UI store — non-domain state that is purely client-side. Holds:
 *   - CSRF token (loaded once at app bootstrap, used by http + WS layers)
 *   - Code-pane visibility (⌘J toggles)
 *   - WebSocket connection state (for the connection banner)
 *   - Composer draft (so the textarea is controlled but state stays out of components)
 *   - Code preview replay speed / pause / selected edit controls
 *   - A simple toast queue (used by `useErrorReporter`) with per-toast TTL
 */
import { create } from "zustand";
import { modelIdSchema, type ModelId, type ReplaySpeed, type WorkspaceAllowlistRow } from "@harness/shared";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

/**
 * Right-pane content selector. The titlebar's Diff/Files/Terminal/Browser
 * buttons drive this. Only `diff` is backed by a real surface today
 * (CodeEditPreviewPanel); the rest render honest "not yet available"
 * placeholders.
 */
export type RightPanelTab = "diff" | "files" | "terminal" | "browser";

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
  /** Left sessions rail collapsed (persisted, mirrors codeHidden). */
  railHidden: boolean;
  /** Which surface the right pane shows when expanded. */
  rightPanelTab: RightPanelTab;
  csrfToken: string | null;
  connectionState: ConnectionState;
  composerDraft: string;
  /**
   * The model the composer will run. Drives the default-agent
   * auto-provisioner (`useEnsureDefaultAgent`): switching it ensures/selects
   * a default agent configured for that model. Persisted across reloads.
   */
  selectedModelId: ModelId;
  replaySpeedByRunId: Record<string, ReplaySpeed>;
  replayPausedByRunId: Record<string, boolean>;
  selectedCodeEditEventByRunId: Record<string, string>;
  toasts: Toast[];
  /**
   * Monotonic counter for toast IDs. Lives on the store rather than at
   * module scope so test resets (`useUiStore.setState`) start from zero
   * and IDs never collide across mounted instances.
   */
  toastCounter: number;
  /**
   * Active-workspace selection. Lives in the store (not per-hook useState)
   * because multiple consumers — AppShell for modal gating, the picker for
   * setActive, Statusbar for the label — must observe the same value or the
   * picker's update never reaches the gate and the modal stays up.
   */
  activeWorkspace: WorkspaceAllowlistRow | null;
  activeWorkspaceId: string | null;
  activeWorkspaceLoading: boolean;
  activeWorkspaceError: string | null;

  setCodeHidden: (hidden: boolean) => void;
  toggleCodeHidden: () => void;
  setRailHidden: (hidden: boolean) => void;
  toggleRailHidden: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  /** Select a tab AND ensure the right pane is visible. */
  openRightPanel: (tab: RightPanelTab) => void;
  setCsrfToken: (token: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setComposerDraft: (draft: string) => void;
  setSelectedModelId: (modelId: ModelId) => void;
  setReplaySpeed: (runId: string, speed: ReplaySpeed) => void;
  setReplayPaused: (runId: string, paused: boolean) => void;
  selectCodeEditEvent: (runId: string, eventId: string | null) => void;
  pushToast: (toast: Omit<Toast, "id" | "createdAt" | "expiresAt"> & { ttlMs?: number | null }) => void;
  dismissToast: (id: string) => void;
  sweepExpiredToasts: (now?: number) => void;
  setActiveWorkspaceData: (data: {
    workspace: WorkspaceAllowlistRow | null;
    activeWorkspaceId: string | null;
  }) => void;
  setActiveWorkspaceLoading: (loading: boolean) => void;
  setActiveWorkspaceError: (error: string | null) => void;
}

const CODE_HIDDEN_STORAGE_KEY = "harness:codeHidden";
const RAIL_HIDDEN_STORAGE_KEY = "harness:railHidden";
const SELECTED_MODEL_STORAGE_KEY = "harness:selectedModelId";

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

function readInitialRailHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(RAIL_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistRailHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RAIL_HIDDEN_STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // Storage unavailable (private mode) — silently ignore.
  }
}

function readInitialSelectedModel(): ModelId {
  if (typeof window === "undefined") return "composer-2-5-fast";
  try {
    const parsed = modelIdSchema.safeParse(
      window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY),
    );
    return parsed.success ? parsed.data : "composer-2-5-fast";
  } catch {
    return "composer-2-5-fast";
  }
}

function persistSelectedModel(modelId: ModelId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, modelId);
  } catch {
    // Storage unavailable (private mode) — silently ignore.
  }
}

export const useUiStore = create<UiState>((set) => ({
  codeHidden: readInitialCodeHidden(),
  railHidden: readInitialRailHidden(),
  rightPanelTab: "diff",
  csrfToken: null,
  connectionState: "idle",
  composerDraft: "",
  selectedModelId: readInitialSelectedModel(),
  replaySpeedByRunId: {},
  replayPausedByRunId: {},
  selectedCodeEditEventByRunId: {},
  toasts: [],
  toastCounter: 0,
  activeWorkspace: null,
  activeWorkspaceId: null,
  // Starts true so AppShell doesn't briefly render the workspace-required
  // modal during the cold-start GET before the server has answered.
  activeWorkspaceLoading: true,
  activeWorkspaceError: null,

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
  setRailHidden: (hidden) => {
    persistRailHidden(hidden);
    set({ railHidden: hidden });
  },
  toggleRailHidden: () => {
    set((s) => {
      const next = !s.railHidden;
      persistRailHidden(next);
      return { railHidden: next };
    });
  },
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  openRightPanel: (tab) => {
    persistCodeHidden(false);
    set({ rightPanelTab: tab, codeHidden: false });
  },
  setCsrfToken: (token) => set({ csrfToken: token }),
  setConnectionState: (state) => set({ connectionState: state }),
  setComposerDraft: (draft) => set({ composerDraft: draft }),
  setSelectedModelId: (modelId) => {
    persistSelectedModel(modelId);
    set({ selectedModelId: modelId });
  },
  setReplaySpeed: (runId, speed) =>
    set((s) => ({ replaySpeedByRunId: { ...s.replaySpeedByRunId, [runId]: speed } })),
  setReplayPaused: (runId, paused) =>
    set((s) => ({ replayPausedByRunId: { ...s.replayPausedByRunId, [runId]: paused } })),
  selectCodeEditEvent: (runId, eventId) =>
    set((s) => {
      const next = { ...s.selectedCodeEditEventByRunId };
      if (eventId === null) delete next[runId];
      else next[runId] = eventId;
      persistCodeHidden(false);
      return { selectedCodeEditEventByRunId: next, codeHidden: false };
    }),
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
  setActiveWorkspaceData: ({ workspace, activeWorkspaceId }) =>
    set({ activeWorkspace: workspace, activeWorkspaceId }),
  setActiveWorkspaceLoading: (loading) => set({ activeWorkspaceLoading: loading }),
  setActiveWorkspaceError: (error) => set({ activeWorkspaceError: error }),
}));
