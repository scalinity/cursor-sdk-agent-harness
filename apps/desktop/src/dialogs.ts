import { dialog, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from "electron";

export type OpenWorkspaceDialogResult =
  | { path: string }
  | { cancelled: true };

export function registerDialogHandlers(): void {
  ipcMain.handle(
    "dialogs:openWorkspaceFolder",
    async (event: IpcMainInvokeEvent): Promise<OpenWorkspaceDialogResult> => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: "Pick a workspace folder",
            buttonLabel: "Use this folder",
            properties: ["openDirectory", "createDirectory"],
          })
        : await dialog.showOpenDialog({
            title: "Pick a workspace folder",
            buttonLabel: "Use this folder",
            properties: ["openDirectory", "createDirectory"],
          });
      const picked = result.filePaths[0];
      if (result.canceled || !picked) {
        return { cancelled: true };
      }
      return { path: picked };
    },
  );
}
