import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SubagentDefinitionRow, SubagentModel } from "@harness/shared";
import { boolFromInt, intFromBool, isoNow, parseJsonArray } from "./mapping.js";

export interface CreateSubagentInput {
  id?: string;
  name: string;
  enabled?: boolean;
  description: string;
  prompt: string;
  model: SubagentModel;
  mcpServerIds?: ReadonlyArray<string>;
}

export interface UpdateSubagentInput {
  name?: string;
  enabled?: boolean;
  description?: string;
  prompt?: string;
  model?: SubagentModel;
  mcpServerIds?: ReadonlyArray<string>;
}

interface SubagentDbRow {
  id: string;
  name: string;
  enabled: number;
  description: string;
  prompt: string;
  model_json: string;
  mcp_server_ids_json: string;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: SubagentDbRow): SubagentDefinitionRow {
  return {
    id: row.id,
    name: row.name,
    enabled: boolFromInt(row.enabled),
    description: row.description,
    prompt: row.prompt,
    model: JSON.parse(row.model_json) as SubagentModel,
    mcpServerIds: parseJsonArray<string>(row.mcp_server_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SubagentDefinitionsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  create(input: CreateSubagentInput): SubagentDefinitionRow {
    const id = input.id ?? randomUUID();
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO subagent_definitions (
            id, name, enabled, description, prompt,
            model_json, mcp_server_ids_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        intFromBool(input.enabled ?? true),
        input.description,
        input.prompt,
        JSON.stringify(input.model),
        JSON.stringify(input.mcpServerIds ?? []),
        now,
        now,
      );
    const row = this.getById(id);
    if (!row) {
      throw new Error(`SubagentDefinitionsRepo.create: row not found id=${id}`);
    }
    return row;
  }

  getById(id: string): SubagentDefinitionRow | null {
    const row = this.raw
      .prepare("SELECT * FROM subagent_definitions WHERE id = ?")
      .get(id) as SubagentDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  list(): SubagentDefinitionRow[] {
    const rows = this.raw
      .prepare("SELECT * FROM subagent_definitions ORDER BY name ASC")
      .all() as SubagentDbRow[];
    return rows.map(rowToDomain);
  }

  update(id: string, input: UpdateSubagentInput): SubagentDefinitionRow {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`SubagentDefinitionsRepo.update: row not found id=${id}`);
    }
    const next = {
      name: input.name ?? existing.name,
      enabled: input.enabled === undefined ? existing.enabled : input.enabled,
      description: input.description ?? existing.description,
      prompt: input.prompt ?? existing.prompt,
      model: input.model ?? existing.model,
      mcpServerIds: input.mcpServerIds ?? existing.mcpServerIds,
    };
    this.raw
      .prepare(
        `UPDATE subagent_definitions
            SET name = ?,
                enabled = ?,
                description = ?,
                prompt = ?,
                model_json = ?,
                mcp_server_ids_json = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.name,
        intFromBool(next.enabled),
        next.description,
        next.prompt,
        JSON.stringify(next.model),
        JSON.stringify(next.mcpServerIds),
        isoNow(),
        id,
      );
    const row = this.getById(id);
    if (!row) {
      throw new Error(`SubagentDefinitionsRepo.update: row vanished id=${id}`);
    }
    return row;
  }

  delete(id: string): void {
    this.raw.prepare("DELETE FROM subagent_definitions WHERE id = ?").run(id);
  }
}
