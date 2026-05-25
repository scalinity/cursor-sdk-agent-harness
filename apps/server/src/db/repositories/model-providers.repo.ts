import { randomUUID } from "node:crypto";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { isoNow } from "./mapping.js";

/**
 * Phase 23 — BYOK provider registry. API keys are NEVER stored here; only the
 * Keychain account name that points at them (`provider:{id}:api-key`).
 */

export interface ModelProviderRow {
  id: string;
  name: string;
  provider: string;
  apiKeyKeychainAccount: string | null;
  baseUrl: string | null;
  models: string[];
  enabled: boolean;
  createdAt: string;
}

interface ModelProviderDbRow {
  id: string;
  name: string;
  provider: string;
  api_key_keychain_account: string | null;
  base_url: string | null;
  models: string;
  enabled: number;
  created_at: string;
}

function rowToDomain(row: ModelProviderDbRow): ModelProviderRow {
  let models: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.models);
    if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === "string");
  } catch {
    models = [];
  }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    apiKeyKeychainAccount: row.api_key_keychain_account,
    baseUrl: row.base_url,
    models,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
  };
}

export interface CreateModelProviderInput {
  id?: string;
  name: string;
  provider: string;
  apiKeyKeychainAccount: string | null;
  baseUrl: string | null;
  models: string[];
  enabled?: boolean;
}

export class ModelProvidersRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  list(): ModelProviderRow[] {
    const rows = this.raw
      .prepare("SELECT * FROM model_providers ORDER BY created_at ASC")
      .all() as ModelProviderDbRow[];
    return rows.map(rowToDomain);
  }

  getById(id: string): ModelProviderRow | null {
    const row = this.raw
      .prepare("SELECT * FROM model_providers WHERE id = ?")
      .get(id) as ModelProviderDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  create(input: CreateModelProviderInput): ModelProviderRow {
    const id = input.id ?? randomUUID();
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO model_providers
           (id, name, provider, api_key_keychain_account, base_url, models, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.provider,
        input.apiKeyKeychainAccount,
        input.baseUrl,
        JSON.stringify(input.models),
        input.enabled === false ? 0 : 1,
        now,
      );
    return this.getById(id)!;
  }

  updateModels(id: string, models: string[]): boolean {
    const result = this.raw
      .prepare("UPDATE model_providers SET models = ? WHERE id = ?")
      .run(JSON.stringify(models), id);
    return result.changes > 0;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const result = this.raw
      .prepare("UPDATE model_providers SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.raw.prepare("DELETE FROM model_providers WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
