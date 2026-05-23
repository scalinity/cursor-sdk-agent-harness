import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, type DbClient } from "../client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "..", "migrations");

export function openTestDb(opts: { skipSeed?: boolean } = {}): DbClient {
  const client = openDb({
    filePath: ":memory:",
    migrationsDir: MIGRATIONS_DIR,
    skipSeed: opts.skipSeed ?? false,
  });
  client.verifyMigrations();
  return client;
}
