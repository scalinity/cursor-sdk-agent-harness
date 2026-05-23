#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

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
