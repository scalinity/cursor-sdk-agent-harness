import { contextBridge, ipcRenderer } from "electron";

const harnessBridge = {
  openWorkspaceFolderDialog: (): Promise<{ path: string } | { cancelled: true }> =>
    ipcRenderer.invoke("dialogs:openWorkspaceFolder"),
  platform: process.platform,
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
