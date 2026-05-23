-- Phase 04 — Cursor SDK Agent Harness initial schema.
-- Mirrors spec-v1.1.md Section 8 verbatim. PRAGMAs are applied by client.ts
-- on connection open; they are included here only as comments for review.
--
--   PRAGMA foreign_keys = ON;
--   PRAGMA journal_mode = WAL;
--   PRAGMA synchronous = NORMAL;
--   PRAGMA busy_timeout = 5000;

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('creating', 'active', 'terminated', 'error')),
  mode TEXT NOT NULL
    CHECK (mode IN ('local', 'cloud')),
  model_id TEXT NOT NULL,
  cwd_json TEXT
    CHECK (cwd_json IS NULL OR json_valid(cwd_json)),
  setting_sources_json TEXT
    CHECK (setting_sources_json IS NULL OR json_valid(setting_sources_json)),
  sandbox_enabled INTEGER
    CHECK (sandbox_enabled IS NULL OR sandbox_enabled IN (0, 1)),
  cloud_options_json TEXT
    CHECK (cloud_options_json IS NULL OR json_valid(cloud_options_json)),
  mcp_server_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(mcp_server_ids_json)),
  subagent_definition_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(subagent_definition_ids_json)),
  sdk_list_seen_at TEXT,
  last_active_at TEXT,
  error_json TEXT
    CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  terminated_at TEXT
);

CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_last_active_at ON agents(last_active_at DESC);
CREATE INDEX idx_agents_mode ON agents(mode);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('CREATING', 'RUNNING', 'FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED')),
  prompt_preview TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  mode TEXT
    CHECK (mode IS NULL OR mode IN ('local', 'cloud')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  duration_ms INTEGER
    CHECK (duration_ms IS NULL OR duration_ms >= 0),
  last_seq INTEGER NOT NULL DEFAULT 0
    CHECK (last_seq >= 0),
  final_text TEXT,
  final_result_json TEXT
    CHECK (final_result_json IS NULL OR json_valid(final_result_json)),
  git_metadata_json TEXT
    CHECK (git_metadata_json IS NULL OR json_valid(git_metadata_json)),

  input_tokens INTEGER
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens INTEGER
    CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  reasoning_tokens INTEGER
    CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  cost_usd_micros INTEGER
    CHECK (cost_usd_micros IS NULL OR cost_usd_micros >= 0),
  usage_source TEXT
    CHECK (usage_source IS NULL OR usage_source IN ('sdk_final_result', 'derived', 'unavailable')),

  error_json TEXT
    CHECK (error_json IS NULL OR json_valid(error_json)),
  interrupted_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_runs_agent_id_started_at ON runs(agent_id, started_at DESC);
CREATE INDEX idx_runs_status_started_at ON runs(status, started_at DESC);
CREATE INDEX idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX idx_runs_model_id_started_at ON runs(model_id, started_at DESC);
CREATE INDEX idx_runs_cost_usd_micros ON runs(cost_usd_micros) WHERE cost_usd_micros IS NOT NULL;
CREATE INDEX idx_runs_usage_source ON runs(usage_source);
CREATE INDEX idx_runs_tokens ON runs(input_tokens, output_tokens);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  seq INTEGER NOT NULL
    CHECK (seq >= 0),
  schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (schema_version = 1),
  sdk_type TEXT NOT NULL
    CHECK (sdk_type IN ('system', 'user', 'assistant', 'thinking', 'tool_call', 'status', 'task', 'request')),
  kind TEXT NOT NULL,
  call_id TEXT,
  request_id TEXT,
  status TEXT,
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json)),
  raw_json TEXT
    CHECK (raw_json IS NULL OR json_valid(raw_json)),
  payload_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (payload_bytes >= 0),
  raw_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (raw_bytes >= 0),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE (run_id, seq)
);

CREATE INDEX idx_events_run_id_seq ON events(run_id, seq);
CREATE INDEX idx_events_agent_id_received_at ON events(agent_id, received_at DESC);
CREATE INDEX idx_events_kind_received_at ON events(kind, received_at DESC);
CREATE INDEX idx_events_call_id ON events(call_id) WHERE call_id IS NOT NULL;
CREATE INDEX idx_events_request_id ON events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_events_status ON events(status) WHERE status IS NOT NULL;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
    CHECK (json_valid(value_json)),
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),
  config_json TEXT NOT NULL
    CHECK (json_valid(config_json)),
  validation_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (validation_status IN ('unknown', 'valid', 'invalid', 'unreachable')),
  validation_message TEXT,
  last_status TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mcp_servers_enabled ON mcp_servers(enabled);
CREATE INDEX idx_mcp_servers_validation_status ON mcp_servers(validation_status);

CREATE TABLE subagent_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model_json TEXT NOT NULL
    CHECK (json_valid(model_json)),
  mcp_server_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(mcp_server_ids_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_subagent_definitions_enabled ON subagent_definitions(enabled);
CREATE INDEX idx_subagent_definitions_name ON subagent_definitions(name);

CREATE TABLE workspace_allowlist (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT,
  recursive INTEGER NOT NULL DEFAULT 1
    CHECK (recursive IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE INDEX idx_workspace_allowlist_path ON workspace_allowlist(path);
CREATE INDEX idx_workspace_allowlist_last_used_at ON workspace_allowlist(last_used_at DESC);
