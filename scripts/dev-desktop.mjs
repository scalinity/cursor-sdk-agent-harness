#!/usr/bin/env node
/**
 * Phase 16 dev orchestrator for desktop mode.
 *
 * - Loads repo-root `.env` so CURSOR_API_KEY reaches the standalone Fastify
 *   server (the same one-shot import path the browser-mode dev script uses).
 * - Spawns the harness server with `HARNESS_DESKTOP=1` so desktop-specific
 *   origins remain accepted during dev.
 * - Spawns the Vite dev server (127.0.0.1:5173) so the renderer can hot-reload.
 * - Spawns Electron via `@harness/desktop`'s `dev` script, which compiles the
 *   main process TS and launches a window pointed at Vite. Packaged builds boot
 *   Fastify in-process; dev keeps Fastify in Node to avoid Electron/Node native
 *   module ABI churn.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { parseDotEnv, applyDotEnvToProcess } from "./lib/parse-dotenv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const repoRootEnv = join(repoRoot, ".env");
if (existsSync(repoRootEnv)) {
  applyDotEnvToProcess(parseDotEnv(readFileSync(repoRootEnv, "utf8")));
}

const procs = [];

function run(name, cmd, args, color, extraEnv = {}) {
  const p = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const tag = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => prefix + line)
      .join("\n") + "\n";
  p.stdout.on("data", (c) => process.stdout.write(tag(c)));
  p.stderr.on("data", (c) => process.stderr.write(tag(c)));
  p.on("exit", (code, signal) => {
    if (shuttingDown) return;
    process.stderr.write(prefix + `exited (code=${code}, signal=${signal})\n`);
    shutdown(code ?? 1);
  });
  procs.push(p);
}

let shuttingDown = false;
function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.killed) p.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 200);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Standalone harness server (desktop origin policy). Electron loads Vite, which
// proxies /api and /ws to this Node process.
run("server", "pnpm", ["--filter", "@harness/server", "run", "dev"], "36", {
  HARNESS_DESKTOP: "1",
});

// Vite dev server hosts the renderer. Electron loads from
// http://127.0.0.1:5173 so HMR keeps working.
run("vite", "pnpm", ["--filter", "@harness/web", "run", "dev"], "35");

// Give the server and Vite a moment to bind before Electron opens the renderer.
setTimeout(() => {
  run("electron", "pnpm", ["--filter", "@harness/desktop", "run", "dev"], "34", {
    HARNESS_DEV: "1",
  });
}, 2000);
