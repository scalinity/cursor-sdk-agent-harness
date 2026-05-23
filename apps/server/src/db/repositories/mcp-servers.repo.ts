import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  McpServerConfig,
  McpServerRow,
  McpValidationStatus,
} from "@harness/shared";
import { boolFromInt, intFromBool, isoNow } from "./mapping.js";

export interface CreateMcpServerInput {
  id?: string;
  name: string;
  enabled?: boolean;
  config: McpServerConfig;
}

export interface UpdateMcpServerInput {
  name?: string;
  enabled?: boolean;
  config?: McpServerConfig;
  validationStatus?: McpValidationStatus;
  validationMessage?: string | null;
  lastStatus?: string | null;
  lastCheckedAt?: string | null;
}

interface McpServerDbRow {
  id: string;
  name: string;
  enabled: number;
  config_json: string;
  validation_status: string;
  validation_message: string | null;
  last_status: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: McpServerDbRow): McpServerRow {
  return {
    id: row.id,
    name: row.name,
    enabled: boolFromInt(row.enabled),
    config: JSON.parse(row.config_json) as McpServerConfig,
    validationStatus: row.validation_status as McpValidationStatus,
    validationMessage: row.validation_message,
    lastStatus: row.last_status,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class McpServersRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  create(input: CreateMcpServerInput): McpServerRow {
    const id = input.id ?? randomUUID();
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO mcp_servers (
            id, name, enabled, config_json,
            validation_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'unknown', ?, ?)`,
      )
      .run(
        id,
        input.name,
        intFromBool(input.enabled ?? true),
        JSON.stringify(input.config),
        now,
        now,
      );
    const row = this.getById(id);
    if (!row) throw new Error(`McpServersRepo.create: row not found id=${id}`);
    return row;
  }

  getById(id: string): McpServerRow | null {
    const row = this.raw
      .prepare("SELECT * FROM mcp_servers WHERE id = ?")
      .get(id) as McpServerDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  getByName(name: string): McpServerRow | null {
    const row = this.raw
      .prepare("SELECT * FROM mcp_servers WHERE name = ?")
      .get(name) as McpServerDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  list(): McpServerRow[] {
    const rows = this.raw
      .prepare("SELECT * FROM mcp_servers ORDER BY name ASC")
      .all() as McpServerDbRow[];
    return rows.map(rowToDomain);
  }

  /**
   * REVIEW-S12: existsBatch — return the subset of `ids` that have a
   * persisted row. Used by the subagent referential-integrity check;
   * previously it called `list()` and rebuilt a Set from all rows,
   * which JSON-parses every row's config just to throw it away.
   */
  existsBatch(ids: ReadonlyArray<string>): Set<string> {
    if (ids.length === 0) return new Set();
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.raw
      .prepare(`SELECT id FROM mcp_servers WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  update(id: string, input: UpdateMcpServerInput): McpServerRow {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`McpServersRepo.update: row not found id=${id}`);
    }
    const next = {
      name: input.name ?? existing.name,
      enabled: input.enabled === undefined ? existing.enabled : input.enabled,
      configJson: input.config ? JSON.stringify(input.config) : null,
      validationStatus: input.validationStatus ?? existing.validationStatus,
      validationMessage:
        input.validationMessage === undefined
          ? existing.validationMessage
          : input.validationMessage,
      lastStatus: input.lastStatus === undefined ? existing.lastStatus : input.lastStatus,
      lastCheckedAt:
        input.lastCheckedAt === undefined ? existing.lastCheckedAt : input.lastCheckedAt,
    };
    this.raw
      .prepare(
        `UPDATE mcp_servers
            SET name = ?,
                enabled = ?,
                config_json = COALESCE(?, config_json),
                validation_status = ?,
                validation_message = ?,
                last_status = ?,
                last_checked_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.name,
        intFromBool(next.enabled),
        next.configJson,
        next.validationStatus,
        next.validationMessage,
        next.lastStatus,
        next.lastCheckedAt,
        isoNow(),
        id,
      );
    const row = this.getById(id);
    if (!row) throw new Error(`McpServersRepo.update: row vanished id=${id}`);
    return row;
  }

  delete(id: string): void {
    this.raw.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  }
}
