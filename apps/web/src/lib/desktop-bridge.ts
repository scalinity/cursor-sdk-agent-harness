/**
 * Feature-detected bridge to the Electron preload script. When the renderer is
 * loaded inside the desktop app, `window.harness` exposes the native folder
 * picker and menu-action subscriptions; in browser mode the export is null and
 * every caller falls back to its text-input UI.
 */
import type {
  BrowserInvokeRequest,
  BrowserInvokeResult,
  BrowserPushEvent,
  DesktopMenuChannel,
} from "@harness/shared";

export type MenuActionChannel = DesktopMenuChannel;

/**
 * Browser-pane control surface. Present only in the desktop app (the embedded
 * Chromium views live in the Electron main process); null in browser mode.
 */
export interface HarnessBrowserBridge {
  invoke: (req: BrowserInvokeRequest) => Promise<BrowserInvokeResult>;
  onEvent: (handler: (event: BrowserPushEvent) => void) => () => void;
}

export interface HarnessBridge {
  openWorkspaceFolderDialog: () => Promise<{ path: string } | { cancelled: true }>;
  platform: string;
  onMenuAction: (channel: MenuActionChannel, handler: () => void) => () => void;
  /**
   * Absolute origin of the standalone harness server (e.g.
   * `http://127.0.0.1:4783`), injected by the Electron main process when the
   * packaged renderer loads from `app://harness`. Null in dev where Vite
   * proxies API/WS same-origin.
   */
  serverOrigin: string | null;
  /** Embedded-browser control surface; null when the preload didn't expose it. */
  browser: HarnessBrowserBridge | null;
}

function readBridge(): HarnessBridge | null {
  if (typeof window === "undefined") return null;
  const exposed = (window as unknown as { harness?: Partial<HarnessBridge> }).harness;
  if (!exposed) return null;
  if (
    typeof exposed.openWorkspaceFolderDialog !== "function" ||
    typeof exposed.onMenuAction !== "function"
  ) {
    return null;
  }
  const rawBrowser = exposed.browser;
  const browser: HarnessBrowserBridge | null =
    rawBrowser &&
    typeof rawBrowser.invoke === "function" &&
    typeof rawBrowser.onEvent === "function"
      ? { invoke: rawBrowser.invoke, onEvent: rawBrowser.onEvent }
      : null;
  return {
    openWorkspaceFolderDialog: exposed.openWorkspaceFolderDialog,
    platform: exposed.platform ?? "",
    onMenuAction: exposed.onMenuAction,
    serverOrigin:
      typeof exposed.serverOrigin === "string" ? exposed.serverOrigin : null,
    browser,
  };
}

export const desktopBridge: HarnessBridge | null = readBridge();
export const isDesktop = desktopBridge !== null;
