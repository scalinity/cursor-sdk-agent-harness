#!/usr/bin/env node
// Apply outstanding SQL migrations to the local SQLite database. Idempotent —
// re-running is safe. The real migrator lives in apps/server/src/db/client.ts
// so the runtime and the CLI share a single code path.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..", "apps", "server");
const tsxBin = path.resolve(serverDir, "node_modules", ".bin", "tsx");
const runnerPath = path.join(serverDir, "src", "scripts", "run-migrations.ts");

if (!fs.existsSync(tsxBin)) {
  process.stderr.write(
    `[migrate] tsx not found at ${tsxBin}.\n` +
      `[migrate] Run \`pnpm install\` from the repo root and try again.\n`,
  );
  process.exit(1);
}

const result = spawnSync(tsxBin, [runnerPath], {
  cwd: serverDir,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  process.stderr.write(`[migrate] failed to spawn tsx: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
