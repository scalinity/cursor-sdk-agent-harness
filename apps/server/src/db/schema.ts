// Drizzle schema. SQL column names are snake_case (per spec §8); the camelCase
// field properties below are the names repositories use to address columns.
// The authoritative DDL lives in db/migrations/0001_initial.sql and is what
// `pnpm migrate` applies. This file exists so the Drizzle client gains typed
// access to the same tables.

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowDefault = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    modelId: text("model_id").notNull(),
    modelParamsJson: text("model_params_json"),
    cwdJson: text("cwd_json"),
    settingSourcesJson: text("setting_sources_json"),
    sandboxEnabled: integer("sandbox_enabled"),
    cloudOptionsJson: text("cloud_options_json"),
    mcpServerIdsJson: text("mcp_server_ids_json").notNull().default("[]"),
    subagentDefinitionIdsJson: text("subagent_definition_ids_json")
      .notNull()
      .default("[]"),
    sdkListSeenAt: text("sdk_list_seen_at"),
    lastActiveAt: text("last_active_at"),
    errorJson: text("error_json"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
    terminatedAt: text("terminated_at"),
  },
  (table) => [
    index("idx_agents_status").on(table.status),
    index("idx_agents_last_active_at").on(table.lastActiveAt),
    index("idx_agents_mode").on(table.mode),
    check(
      "agents_status_check",
      sql`${table.status} IN ('creating', 'active', 'terminated', 'error')`,
    ),
    check("agents_mode_check", sql`${table.mode} IN ('local', 'cloud')`),
    check(
      "agents_model_params_json_valid",
      sql`${table.modelParamsJson} IS NULL OR json_valid(${table.modelParamsJson})`,
    ),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    status: text("status").notNull(),
    promptPreview: text("prompt_preview").notNull().default(""),
    name: text("name"),
    modelId: text("model_id"),
    mode: text("mode"),
    executionMode: text("execution_mode"),
    parentRunId: text("parent_run_id"),
    workspaceId: text("workspace_id"),
    startedAt: text("started_at").notNull().default(nowDefault),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
    lastSeq: integer("last_seq").notNull().default(0),
    finalText: text("final_text"),
    finalResultJson: text("final_result_json"),
    gitMetadataJson: text("git_metadata_json"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    costUsdMicros: integer("cost_usd_micros"),
    usageSource: text("usage_source"),
    // Last turn's per-turn usage — context-occupancy estimate (see 0007).
    lastTurnInputTokens: integer("last_turn_input_tokens"),
    lastTurnOutputTokens: integer("last_turn_output_tokens"),
    errorJson: text("error_json"),
    interruptedReason: text("interrupted_reason"),
    contextMetadata: text("context_metadata"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    foreignKey({
      columns: [table.agentId],
      foreignColumns: [agents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.parentRunId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
    index("idx_runs_agent_id_started_at").on(table.agentId, table.startedAt),
    index("idx_runs_status_started_at").on(table.status, table.startedAt),
    index("idx_runs_parent").on(table.parentRunId),
    index("idx_runs_workspace_id_started_at").on(table.workspaceId, table.startedAt),
    index("idx_runs_started_at").on(table.startedAt),
    index("idx_runs_model_id_started_at").on(table.modelId, table.startedAt),
    index("idx_runs_cost_usd_micros").on(table.costUsdMicros),
    index("idx_runs_usage_source").on(table.usageSource),
    index("idx_runs_tokens").on(table.inputTokens, table.outputTokens),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    seq: integer("seq").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    sdkType: text("sdk_type").notNull(),
    kind: text("kind").notNull(),
    callId: text("call_id"),
    requestId: text("request_id"),
    status: text("status"),
    payloadJson: text("payload_json").notNull(),
    rawJson: text("raw_json"),
    payloadBytes: integer("payload_bytes").notNull().default(0),
    rawBytes: integer("raw_bytes").notNull().default(0),
    occurredAt: text("occurred_at").notNull(),
    receivedAt: text("received_at").notNull().default(nowDefault),
    createdAt: text("created_at").notNull().default(nowDefault),
  },
  (table) => [
    foreignKey({
      columns: [table.runId],
      foreignColumns: [runs.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.agentId],
      foreignColumns: [agents.id],
    }).onDelete("cascade"),
    uniqueIndex("uniq_events_run_seq").on(table.runId, table.seq),
    index("idx_events_run_id_seq").on(table.runId, table.seq),
    index("idx_events_agent_id_received_at").on(table.agentId, table.receivedAt),
    index("idx_events_kind_received_at").on(table.kind, table.receivedAt),
    index("idx_events_call_id").on(table.callId),
    index("idx_events_request_id").on(table.requestId),
    index("idx_events_status").on(table.status),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  description: text("description"),
  updatedAt: text("updated_at").notNull().default(nowDefault),
});

export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    enabled: integer("enabled").notNull().default(1),
    configJson: text("config_json").notNull(),
    validationStatus: text("validation_status").notNull().default("unknown"),
    validationMessage: text("validation_message"),
    lastStatus: text("last_status"),
    lastCheckedAt: text("last_checked_at"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("idx_mcp_servers_enabled").on(table.enabled),
    index("idx_mcp_servers_validation_status").on(table.validationStatus),
  ],
);

export const subagentDefinitions = sqliteTable(
  "subagent_definitions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    enabled: integer("enabled").notNull().default(1),
    description: text("description").notNull(),
    prompt: text("prompt").notNull(),
    modelJson: text("model_json").notNull(),
    mcpServerIdsJson: text("mcp_server_ids_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
  },
  (table) => [
    index("idx_subagent_definitions_enabled").on(table.enabled),
    index("idx_subagent_definitions_name").on(table.name),
  ],
);

export const workspaceAllowlist = sqliteTable(
  "workspace_allowlist",
  {
    id: text("id").primaryKey(),
    path: text("path").notNull().unique(),
    label: text("label"),
    recursive: integer("recursive").notNull().default(1),
    createdAt: text("created_at").notNull().default(nowDefault),
    updatedAt: text("updated_at").notNull().default(nowDefault),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [
    index("idx_workspace_allowlist_path").on(table.path),
    index("idx_workspace_allowlist_last_used_at").on(table.lastUsedAt),
  ],
);
