import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { SettingRow } from "@harness/shared";
import { isoNow } from "./mapping.js";

interface SettingDbRow {
  key: string;
  value_json: string;
  description: string | null;
  updated_at: string;
}

function rowToDomain(row: SettingDbRow): SettingRow {
  return {
    key: row.key,
    value: JSON.parse(row.value_json),
    description: row.description,
    updatedAt: row.updated_at,
  };
}

export class SettingsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  get<T = unknown>(key: string): T | undefined {
    const row = this.raw
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(key) as { value_json: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value_json) as T;
  }

  /**
   * Bulk-read a known set of keys. Returns a `Map` of `key → parsed value`
   * for keys that are present. Missing keys are omitted (caller decides the
   * default). One SELECT regardless of input size.
   */
  getMany(keys: ReadonlyArray<string>): Map<string, unknown> {
    if (keys.length === 0) return new Map();
    const placeholders = keys.map(() => "?").join(",");
    const rows = this.raw
      .prepare(`SELECT key, value_json FROM settings WHERE key IN (${placeholders})`)
      .all(...keys) as Array<{ key: string; value_json: string }>;
    const out = new Map<string, unknown>();
    for (const row of rows) {
      out.set(row.key, JSON.parse(row.value_json));
    }
    return out;
  }

  getRow(key: string): SettingRow | null {
    const row = this.raw
      .prepare("SELECT * FROM settings WHERE key = ?")
      .get(key) as SettingDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  set(key: string, value: unknown, description?: string): void {
    this.raw
      .prepare(
        `INSERT INTO settings (key, value_json, description, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           description = COALESCE(excluded.description, settings.description),
           updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value ?? null), description ?? null, isoNow());
  }

  delete(key: string): void {
    this.raw.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  getAll(): SettingRow[] {
    const rows = this.raw
      .prepare("SELECT * FROM settings ORDER BY key ASC")
      .all() as SettingDbRow[];
    return rows.map(rowToDomain);
  }
}
