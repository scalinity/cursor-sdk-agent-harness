/**
 * API origin resolution for the renderer.
 *
 * In the browser and in `pnpm dev` (Electron loading the Vite dev server at
 * http://127.0.0.1:5173), the renderer is same-origin with the API: requests
 * stay relative (`/api/...`, `/ws`) and the Vite proxy forwards them to the
 * Fastify server. `API_BASE` is empty in that case.
 *
 * In the packaged desktop app the renderer is served from `app://harness`, a
 * custom protocol that can only return static files — it cannot reach the
 * harness API. The Electron main process therefore passes the standalone
 * server's real origin (e.g. `http://127.0.0.1:4783`, overridable via
 * `HARNESS_SERVER_URL`) through the preload bridge, and every API/WS call is
 * rewritten to that absolute origin. Start the server separately with
 * `HARNESS_DESKTOP=1` so it accepts `app://harness` as a CORS + origin-policy
 * + WS-upgrade origin (see `apps/server/src/app.ts` desktop-mode wiring).
 */
import { desktopBridge } from "./desktop-bridge.js";

export const API_BASE: string = desktopBridge?.serverOrigin ?? "";

/** Prefix a root-relative API path with the server origin when running in the
 *  packaged desktop app. No-op (returns `path` unchanged) in browser/dev. */
export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  return path.startsWith("/") ? `${API_BASE}${path}` : path;
}

/** Build the WebSocket URL for a root-relative path. Returns an absolute
 *  `ws(s)://` URL in the packaged desktop app (derived from `API_BASE`) and
 *  the original relative path in browser/dev, where `useWebSocket` resolves it
 *  against `window.location`. */
export function wsUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/^http/, "ws")}${path}`;
}
