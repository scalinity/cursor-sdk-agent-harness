import { contextBridge, ipcRenderer } from "electron";

// The main process passes the embedded server's resolved origin via an
// `--harness-server-origin=<url>` additionalArgument (see main.ts). The
// packaged renderer loads from app://harness and needs this absolute origin
// to reach the API/WS; reading it from argv keeps it available across
// client-side navigations (unlike a one-shot query param).
const SERVER_ORIGIN_FLAG = "--harness-server-origin=";
function readServerOrigin(): string | null {
  const arg = process.argv.find((a) => a.startsWith(SERVER_ORIGIN_FLAG));
  return arg ? arg.slice(SERVER_ORIGIN_FLAG.length) : null;
}

const harnessBridge = {
  openWorkspaceFolderDialog: (): Promise<{ path: string } | { cancelled: true }> =>
    ipcRenderer.invoke("dialogs:openWorkspaceFolder"),
  platform: process.platform,
  serverOrigin: readServerOrigin(),
  /**
   * Subscribe to native menu actions from the main process. Returns an
   * unsubscribe function.
   */
  onMenuAction: (
    channel:
      | "menu:new-agent"
      | "menu:open-workspace"
      | "menu:toggle-code-pane"
      | "menu:preferences",
    handler: () => void,
  ): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("harness", harnessBridge);
