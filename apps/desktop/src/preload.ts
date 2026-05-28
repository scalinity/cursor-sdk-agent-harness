import { contextBridge, ipcRenderer } from "electron";
import type { MainProcessMenuChannel } from "./menu.js";
import type {
  BrowserInvokeRequest,
  BrowserInvokeResult,
  BrowserPushEvent,
} from "@harness/shared" with { "resolution-mode": "import" };

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
  onMenuAction: (channel: MainProcessMenuChannel, handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  browser: {
    invoke: (req: BrowserInvokeRequest): Promise<BrowserInvokeResult> =>
      ipcRenderer.invoke("browser:invoke", req) as Promise<BrowserInvokeResult>,
    onEvent: (handler: (event: BrowserPushEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: BrowserPushEvent): void => handler(event);
      ipcRenderer.on("browser:event", listener);
      return () => ipcRenderer.removeListener("browser:event", listener);
    },
  },
};

contextBridge.exposeInMainWorld("harness", harnessBridge);
