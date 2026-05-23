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
}

function readBridge(): HarnessBridge | null {
  if (typeof window === "undefined") return null;
  const exposed = (window as unknown as { harness?: HarnessBridge }).harness;
  if (!exposed) return null;
  if (
    typeof exposed.openWorkspaceFolderDialog !== "function" ||
    typeof exposed.onMenuAction !== "function"
  ) {
    return null;
  }
  return exposed;
}

export const desktopBridge: HarnessBridge | null = readBridge();
export const isDesktop = desktopBridge !== null;
