/** Default loopback URL for a separately started `@harness/server` process. */
export const DEFAULT_HARNESS_SERVER_URL = "http://127.0.0.1:4783";

/**
 * Resolve the harness API origin the desktop renderer should call.
 * Matches the CLI's `HARNESS_SERVER_URL` convention.
 */
export function resolveHarnessServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HARNESS_SERVER_URL?.trim();
  const url = raw && raw.length > 0 ? raw : DEFAULT_HARNESS_SERVER_URL;
  return url.replace(/\/$/, "");
}

/**
 * When the renderer loads from Vite (`HARNESS_DEV=1`), API/WS stay same-origin
 * via the dev proxy — no absolute server origin is injected. Packaged builds
 * load from `app://harness` and must reach the external server cross-origin.
 */
export function rendererServerOrigin(isDev: boolean, env: NodeJS.ProcessEnv = process.env): string | null {
  if (isDev) return null;
  return resolveHarnessServerUrl(env);
}
