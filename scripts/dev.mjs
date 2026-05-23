#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

// F-003: load the repo-root .env so child processes inherit it via
// process.env. The server's `dotenv/config` import looks in cwd
// (apps/server when pnpm scopes the script there), so without this
// pre-load the CURSOR_API_KEY bootstrap never imports the key into the
// Keychain on first boot. Parse here instead of requiring a runtime
// dependency on `dotenv` so this orchestrator stays self-contained.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRootEnv = join(__dirname, "..", ".env");
if (existsSync(repoRootEnv)) {
  const raw = readFileSync(repoRootEnv, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const procs = [];

function run(name, cmd, args, color) {
  const p = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
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

run("server", "pnpm", ["--filter", "@harness/server", "run", "dev"], "36");
run("web", "pnpm", ["--filter", "@harness/web", "run", "dev"], "35");
