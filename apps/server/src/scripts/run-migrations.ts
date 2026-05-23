// Standalone migration runner — invoked by scripts/migrate.mjs (the root
// `pnpm migrate` entry) and also useful for ad-hoc debugging.

import { loadEnv } from "../config/env.js";
import { openDb } from "../db/client.js";

function main(): void {
  const env = loadEnv();
  const client = openDb({ filePath: env.DB_PATH });
  try {
    const { applied, seeded } = client.verifyMigrations();
    process.stdout.write(
      `[migrate] db=${env.DB_PATH}\n[migrate] applied=${applied} seeded=${seeded}\n`,
    );
  } finally {
    client.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[migrate] failed: ${(error as Error).message}\n`);
  process.exit(1);
}
