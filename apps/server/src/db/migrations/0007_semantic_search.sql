-- Phase 23: Semantic Search and Multi-Model Support
-- Three tables:
--   embeddings      — per-chunk vector store (Float32Array serialized to BLOB)
--   index_status    — per-workspace indexing progress
--   model_providers — BYOK provider configs (keys live in Keychain, not here)
-- Timestamps use the project-wide ISO-8601 format (matches schema.ts nowDefault)
-- so they round-trip through isoDateTimeSchema.

-- File embedding chunks ------------------------------------------------------
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  language TEXT,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,          -- Float32Array serialized to buffer
  content_hash TEXT NOT NULL,       -- SHA-256 of content for change detection
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_workspace ON embeddings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_file ON embeddings(workspace_id, file_path);
CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON embeddings(content_hash);

-- Indexing status per workspace ---------------------------------------------
CREATE TABLE IF NOT EXISTS index_status (
  workspace_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'indexing', 'indexed', 'error', 'stale')),
  total_files INTEGER NOT NULL DEFAULT 0,
  indexed_files INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  last_indexed_at TEXT,
  error_message TEXT
);

-- Model provider configurations ---------------------------------------------
CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL
    CHECK (provider IN ('cursor', 'anthropic', 'openai', 'google', 'ollama')),
  api_key_keychain_account TEXT,    -- Keychain account name (not the key itself)
  base_url TEXT,                     -- Custom base URL (for proxies or Ollama)
  models TEXT NOT NULL DEFAULT '[]'  -- JSON array of available model IDs
    CHECK (json_valid(models)),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_model_providers_provider ON model_providers(provider);
CREATE INDEX IF NOT EXISTS idx_model_providers_enabled ON model_providers(enabled);
