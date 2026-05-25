-- Phase 19: Execution modes (ask/agent/yolo), run names, and FTS search.
--
-- Column name is `execution_mode` (not `mode`) because `mode` already stores
-- the agent deployment mode (local/cloud) on both agents and runs.

-- Execution mode on agents (default mode for new runs)
ALTER TABLE agents ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'agent'
  CHECK (execution_mode IN ('ask', 'agent', 'yolo'));

-- Execution mode on runs (mode used for this specific run)
ALTER TABLE runs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'agent'
  CHECK (execution_mode IN ('ask', 'agent', 'yolo'));

-- User-assigned session name (nullable; null = auto-generated from prompt)
ALTER TABLE runs ADD COLUMN name TEXT;

-- Full-text search index for run history
CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(
  run_id UNINDEXED,
  prompt,
  name,
  tokenize='porter unicode61'
);

-- Populate FTS on run insert
CREATE TRIGGER runs_fts_insert AFTER INSERT ON runs BEGIN
  INSERT INTO runs_fts(run_id, prompt, name)
  VALUES (NEW.id, NEW.prompt_preview, NEW.name);
END;

-- Update FTS on run name change
CREATE TRIGGER runs_fts_update AFTER UPDATE OF name, prompt_preview ON runs BEGIN
  DELETE FROM runs_fts WHERE run_id = OLD.id;
  INSERT INTO runs_fts(run_id, prompt, name)
  VALUES (NEW.id, NEW.prompt_preview, NEW.name);
END;

-- Clean up FTS on run delete
CREATE TRIGGER runs_fts_delete AFTER DELETE ON runs BEGIN
  DELETE FROM runs_fts WHERE run_id = OLD.id;
END;

-- Backfill existing runs
INSERT INTO runs_fts(run_id, prompt, name)
SELECT id, prompt_preview, name FROM runs;
