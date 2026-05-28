#!/usr/bin/env node
/**
 * Dev-loop helper: compile the desktop TS to dist/ then spawn Electron pointing
 * at it. The renderer is loaded from the Vite dev server (HARNESS_DEV_URL) so
 * hot reload works as usual. API/WS are proxied by Vite to the standalone
 * harness server started by `pnpm dev:desktop`.
 *
 * Expected env vars:
 *   HARNESS_DEV=1           (set automatically)
 *   HARNESS_DEV_URL         (defaults to http://127.0.0.1:5173)
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");

const build = spawnSync(
  "pnpm",
  ["--filter", "@harness/desktop", "run", "build"],
  { stdio: "inherit" },
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const electron = spawn(
  join(desktopRoot, "node_modules", ".bin", "electron"),
  [join(desktopRoot, "dist", "main.js")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HARNESS_DEV: "1",
    },
  },
);

electron.on("exit", (code) => process.exit(code ?? 0));
