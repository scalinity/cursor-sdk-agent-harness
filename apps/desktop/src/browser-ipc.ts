import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { BrowserController } from "./browser-controller.js";
import type { BrowserInvokeRequest, BrowserInvokeResult } from "@harness/shared" with { "resolution-mode": "import" };

/**
 * Phase 18 — `browser:*` IPC seam between the sandboxed renderer and the
 * main-process `BrowserController`.
 *
 *  - `browser:invoke` (renderer → main, request/response): manual driving +
 *    lifecycle + placeholder positioning. The renderer validates the payload
 *    against `browserInvokeRequestSchema` (Zod) before sending; the main
 *    process is CJS and cannot `require()` the ESM-only `@harness/shared`
 *    schema value, so it accepts the typed shape with a light discriminant
 *    guard. This is a same-app loopback channel from our own sandboxed
 *    renderer — exactly the trust model `dialogs.ts` already uses.
 *  - `browser:event` (main → renderer, push): live state + action-overlay
 *    events, forwarded from `BrowserController.onPush`.
 *
 * Programmatic agent actions do NOT pass through here — they are invoked
 * in-process by the built-in MCP server, which runs in the same main process
 * as the controller (Phase 16: Fastify is embedded in Electron's main).
 */
export function registerBrowserIpc(
  controller: BrowserController,
  getWindow: () => BrowserWindow | null,
): void {
  controller.setOnPush((event) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("browser:event", event);
    }
  });

  ipcMain.handle(
    "browser:invoke",
    async (_event: IpcMainInvokeEvent, raw: unknown): Promise<BrowserInvokeResult> => {
      if (
        raw === null ||
        typeof raw !== "object" ||
        typeof (raw as { op?: unknown }).op !== "string" ||
        typeof (raw as { agentId?: unknown }).agentId !== "string"
      ) {
        return { ok: false, error: "invalid browser:invoke request" };
      }
      const req = raw as BrowserInvokeRequest;
      try {
        switch (req.op) {
          case "ensure":
            controller.ensure(req.agentId);
            return { ok: true, state: controller.snapshotState(req.agentId) };
          case "position":
            controller.positionFor(req.agentId, req.rect);
            return { ok: true, state: controller.snapshotState(req.agentId) };
          case "hide":
            controller.hide(req.agentId);
            return { ok: true, state: controller.snapshotState(req.agentId) };
          case "navigate":
            return { ok: true, state: await controller.navigate(req.agentId, req.url) };
          case "back":
            return { ok: true, state: controller.back(req.agentId) };
          case "forward":
            return { ok: true, state: controller.forward(req.agentId) };
          case "reload":
            return { ok: true, state: controller.reload(req.agentId) };
          case "stop":
            return { ok: true, state: controller.stop(req.agentId) };
          case "getState":
            return { ok: true, state: controller.snapshotState(req.agentId) };
          case "destroy":
            await controller.destroy(req.agentId);
            return { ok: true, state: controller.snapshotState(req.agentId) };
          default: {
            const _exhaustive: never = req;
            return { ok: false, error: `unknown op: ${String((_exhaustive as { op?: string }).op)}` };
          }
        }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
