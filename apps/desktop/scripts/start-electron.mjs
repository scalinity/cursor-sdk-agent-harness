#!/usr/bin/env node
/**
 * Dev-loop helper: compile the desktop TS to dist/ then spawn Electron pointing
 * at it. The renderer is loaded from the Vite dev server (HARNESS_DEV_URL) so
 * hot reload works as usual.
 *
 * Expected env vars:
 *   HARNESS_DEV=1           (set automatically)
 *   HARNESS_DEV_URL         (defaults to http://127.0.0.1:5173)
 *   HARNESS_DESKTOP=1       (set so the in-process Fastify accepts app://harness)
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");

// 1. Build the desktop TS sources so dist/ exists.
const build = spawnSync(
  "pnpm",
  ["--filter", "@harness/desktop", "run", "build"],
  { stdio: "inherit" },
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

// 2. Build the server too so dist/programmatic.js exists.
const serverBuild = spawnSync(
  "pnpm",
  ["--filter", "@harness/server", "run", "build"],
  { stdio: "inherit" },
);
if (serverBuild.status !== 0) {
  process.exit(serverBuild.status ?? 1);
}

// 3. Launch Electron pointed at dist/main.js.
const electron = spawn(
  join(desktopRoot, "node_modules", ".bin", "electron"),
  [join(desktopRoot, "dist", "main.js")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HARNESS_DEV: "1",
      HARNESS_DESKTOP: "1",
    },
  },
);

electron.on("exit", (code) => process.exit(code ?? 0));
