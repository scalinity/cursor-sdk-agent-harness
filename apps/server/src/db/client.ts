import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";
import { seedDefaultSettingsIfEmpty, backfillPricingDefaultsIfUnconfigured } from "./seed.js";

export type HarnessDb = BetterSQLite3Database<typeof schema>;

export interface DbClient {
  /** Drizzle handle used by repositories. */
  readonly db: HarnessDb;
  /** Raw better-sqlite3 handle for transaction control + pragmas. */
  readonly raw: BetterSqlite3Database;
  /** Apply outstanding migrations + seed defaults. Idempotent. */
  verifyMigrations(): { applied: number; seeded: boolean };
  close(): void;
}

export interface OpenDbOptions {
  /** Absolute SQLite file path, or ":memory:". */
  filePath: string;
  /** Override the migrations directory (defaults to ./migrations next to this file). */
  migrationsDir?: string;
  /** Skip seeding defaults — used by tests that want a bare schema. */
  skipSeed?: boolean;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(moduleDir, "migrations");

const MIGRATION_FILE_PATTERN = /^(\d+)_[A-Za-z0-9_-]+\.sql$/;

export function openDb(options: OpenDbOptions): DbClient {
  const { filePath } = options;
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const raw = new Database(filePath);
  raw.pragma("foreign_keys = ON");
  if (filePath !== ":memory:") {
    // WAL is meaningless for in-memory dbs; only enable for on-disk databases.
    raw.pragma("journal_mode = WAL");
  }
  raw.pragma("synchronous = NORMAL");
  raw.pragma("busy_timeout = 5000");

  const db = drizzle(raw, { schema });

  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;

  function verifyMigrations(): { applied: number; seeded: boolean } {
    const applied = applyMigrations(raw, migrationsDir);
    const seeded = options.skipSeed === true ? false : seedDefaultSettingsIfEmpty(raw);
    if (options.skipSeed !== true) {
      backfillPricingDefaultsIfUnconfigured(raw);
    }
    return { applied, seeded };
  }

  function close(): void {
    raw.close();
  }

  return { db, raw, verifyMigrations, close };
}

function applyMigrations(raw: BetterSqlite3Database, dir: string): number {
  raw.exec(
    `CREATE TABLE IF NOT EXISTS _harness_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );

  if (!fs.existsSync(dir)) {
    return 0;
  }

  const files = fs
    .readdirSync(dir)
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort();

  const alreadyApplied = new Set(
    raw
      .prepare("SELECT name FROM _harness_migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  let appliedCount = 0;
  const insert = raw.prepare("INSERT INTO _harness_migrations(name) VALUES (?)");

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;
    const sqlText = fs.readFileSync(path.join(dir, file), "utf8");
    const apply = raw.transaction(() => {
      raw.exec(sqlText);
      insert.run(file);
    });
    apply();
    appliedCount += 1;
  }

  return appliedCount;
}
