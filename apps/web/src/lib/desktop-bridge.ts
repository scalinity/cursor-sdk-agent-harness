/**
 * Feature-detected bridge to the Electron preload script. When the renderer is
 * loaded inside the desktop app, `window.harness` exposes the native folder
 * picker and menu-action subscriptions; in browser mode the export is null and
 * every caller falls back to its text-input UI.
 */
export type MenuActionChannel =
  | "menu:new-agent"
  | "menu:open-workspace"
  | "menu:toggle-code-pane"
  | "menu:preferences";

export interface HarnessBridge {
  openWorkspaceFolderDialog: () => Promise<{ path: string } | { cancelled: true }>;
  platform: string;
  onMenuAction: (channel: MenuActionChannel, handler: () => void) => () => void;
  /**
   * Absolute origin of the embedded Fastify server (e.g.
   * `http://127.0.0.1:4783`), injected by the Electron main process. The
   * packaged renderer loads from `app://harness` and must call this origin
   * cross-origin for API/WS. Null when the main process didn't supply it
   * (older preload, or a launch path that couldn't resolve the URL).
   */
  serverOrigin: string | null;
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
  return {
    openWorkspaceFolderDialog: exposed.openWorkspaceFolderDialog,
    platform: exposed.platform ?? "",
    onMenuAction: exposed.onMenuAction,
    serverOrigin:
      typeof exposed.serverOrigin === "string" ? exposed.serverOrigin : null,
  };
}

export const desktopBridge: HarnessBridge | null = readBridge();
export const isDesktop = desktopBridge !== null;
