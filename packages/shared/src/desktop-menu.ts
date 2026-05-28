/**
 * IPC channels the Electron main process may emit via `webContents.send`.
 * The renderer preload union and AppShell handlers must stay aligned.
 */
export const desktopMenuChannels = [
  "menu:new-agent",
  "menu:open-workspace",
  "menu:toggle-code-pane",
  "menu:preferences",
] as const;

export type DesktopMenuChannel = (typeof desktopMenuChannels)[number];
