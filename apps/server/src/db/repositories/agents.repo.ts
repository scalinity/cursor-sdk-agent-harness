import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  executionModeSchema,
  type AgentMode,
  type AgentRow,
  type AgentStatus,
  type CloudAgentOptions,
  type ExecutionMode,
  type SettingSource,
} from "@harness/shared";
import {
  boolFromInt,
  intFromBool,
  isoNow,
  parseJsonArray,
  parseJsonOrNull,
  stringifyOrNull,
} from "./mapping.js";

export interface CreateAgentInput {
  id?: string;
  name: string;
  status: AgentStatus;
  mode: AgentMode;
  executionMode?: ExecutionMode;
  modelId: string;
  cwd?: ReadonlyArray<string> | null;
  settingSources?: ReadonlyArray<SettingSource> | null;
  sandboxEnabled?: boolean | null;
  cloudOptions?: CloudAgentOptions | null;
  mcpServerIds?: ReadonlyArray<string>;
  subagentDefinitionIds?: ReadonlyArray<string>;
}

interface AgentDbRow {
  id: string;
  name: string;
  status: string;
  mode: string;
  execution_mode: string;
  model_id: string;
  cwd_json: string | null;
  setting_sources_json: string | null;
  sandbox_enabled: number | null;
  cloud_options_json: string | null;
  mcp_server_ids_json: string;
  subagent_definition_ids_json: string;
  sdk_list_seen_at: string | null;
  last_active_at: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  terminated_at: string | null;
}

function rowToDomain(row: AgentDbRow): AgentRow {
  return {
    id: row.id,
    name: row.name,
    status: row.status as AgentStatus,
    mode: row.mode as AgentMode,
    executionMode: executionModeSchema.parse(row.execution_mode),
    modelId: row.model_id,
    cwd: parseJsonOrNull<string[]>(row.cwd_json),
    settingSources: parseJsonOrNull<SettingSource[]>(row.setting_sources_json),
    sandboxEnabled:
      row.sandbox_enabled === null ? null : boolFromInt(row.sandbox_enabled),
    cloudOptions: parseJsonOrNull<CloudAgentOptions>(row.cloud_options_json),
    mcpServerIds: parseJsonArray<string>(row.mcp_server_ids_json),
    subagentDefinitionIds: parseJsonArray<string>(row.subagent_definition_ids_json),
    sdkListSeenAt: row.sdk_list_seen_at,
    lastActiveAt: row.last_active_at,
    error: parseJsonOrNull(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terminatedAt: row.terminated_at,
  };
}

export class AgentsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  create(input: CreateAgentInput): AgentRow {
    const id = input.id ?? randomUUID();
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO agents (
            id, name, status, mode, execution_mode, model_id,
            cwd_json, setting_sources_json, sandbox_enabled,
            cloud_options_json, mcp_server_ids_json, subagent_definition_ids_json,
            created_at, updated_at
          ) VALUES (
            @id, @name, @status, @mode, @execution_mode, @model_id,
            @cwd_json, @setting_sources_json, @sandbox_enabled,
            @cloud_options_json, @mcp_server_ids_json, @subagent_definition_ids_json,
            @created_at, @updated_at
          )`,
      )
      .run({
        id,
        name: input.name,
        status: input.status,
        mode: input.mode,
        execution_mode: input.executionMode ?? "agent",
        model_id: input.modelId,
        cwd_json: stringifyOrNull(input.cwd ?? null),
        setting_sources_json: stringifyOrNull(input.settingSources ?? null),
        sandbox_enabled:
          input.sandboxEnabled === undefined || input.sandboxEnabled === null
            ? null
            : intFromBool(input.sandboxEnabled),
        cloud_options_json: stringifyOrNull(input.cloudOptions ?? null),
        mcp_server_ids_json: JSON.stringify(input.mcpServerIds ?? []),
        subagent_definition_ids_json: JSON.stringify(
          input.subagentDefinitionIds ?? [],
        ),
        created_at: now,
        updated_at: now,
      });
    const row = this.getById(id);
    if (!row) {
      throw new Error(`AgentsRepo.create: inserted row not found for id=${id}`);
    }
    return row;
  }

  getById(id: string): AgentRow | null {
    const row = this.raw
      .prepare("SELECT * FROM agents WHERE id = ?")
      .get(id) as AgentDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  list(): AgentRow[] {
    const rows = this.raw
      .prepare("SELECT * FROM agents ORDER BY created_at DESC")
      .all() as AgentDbRow[];
    return rows.map(rowToDomain);
  }

  updateStatus(id: string, status: AgentStatus, error?: unknown): void {
    this.raw
      .prepare(
        `UPDATE agents
            SET status = ?,
                error_json = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(status, stringifyOrNull(error ?? null), isoNow(), id);
  }

  updateLastActiveAt(id: string, when: Date = new Date()): void {
    const iso = when.toISOString();
    this.raw
      .prepare(
        `UPDATE agents
            SET last_active_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(iso, iso, id);
  }

  updateExecutionMode(id: string, executionMode: ExecutionMode): void {
    this.raw
      .prepare(
        `UPDATE agents
            SET execution_mode = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(executionMode, isoNow(), id);
  }

  updateModel(id: string, modelId: string): void {
    this.raw
      .prepare(
        `UPDATE agents
            SET model_id = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(modelId, isoNow(), id);
  }

  terminate(id: string): void {
    const now = isoNow();
    this.raw
      .prepare(
        `UPDATE agents
            SET status = 'terminated',
                terminated_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(now, now, id);
  }

  delete(id: string): void {
    this.raw.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  /**
   * Atomically swap an agent's durable id. Used by AgentRuntime.create when
   * the SDK rotates the agentId after `Agent.create(...)` resolves. The
   * delete+insert pair runs inside a single `db.transaction(...)` so a
   * failed re-insert leaves the original row intact rather than losing the
   * record entirely.
   *
   * The new row preserves every field from `input` so the caller (which
   * has the SDK-confirmed shape) is the single source of truth.
   *
   * Throws if the new id already exists (UNIQUE collision) — the
   * transaction rolls back automatically.
   */
  swapId(oldId: string, input: CreateAgentInput & { id: string }): AgentRow {
    const swap = this.raw.transaction((next: CreateAgentInput & { id: string }) => {
      this.raw.prepare("DELETE FROM agents WHERE id = ?").run(oldId);
      this.create(next);
    });
    swap(input);
    const row = this.getById(input.id);
    if (!row) {
      throw new Error(
        `AgentsRepo.swapId: replacement row not found after swap id=${input.id}`,
      );
    }
    return row;
  }
}
