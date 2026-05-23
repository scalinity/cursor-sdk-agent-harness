import { protocol, net } from "electron";
import { pathToFileURL } from "node:url";
import { join, normalize } from "node:path";

/**
 * Registers the `app://harness/...` protocol used by the production renderer.
 * In dev the renderer is loaded from `http://127.0.0.1:5173` and this
 * registration is a no-op (we still register but never navigate to it).
 *
 * Files are read from `rendererRoot`, which in production is the bundled
 * Vite `dist/` directory shipped via electron-builder `extraResources`.
 */
export function registerAppProtocol(rendererRoot: string): void {
  protocol.handle("app", async (request: Request) => {
    const url = new URL(request.url);
    if (url.host !== "harness") {
      return new Response("forbidden", { status: 403 });
    }
    // Strip leading slash and normalize to prevent traversal.
    const requested = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const resolved = normalize(join(rendererRoot, requested || "index.html"));
    if (!resolved.startsWith(normalize(rendererRoot))) {
      return new Response("forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}
