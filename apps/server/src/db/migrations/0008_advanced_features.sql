-- Phase 24: Advanced agent features.
-- Child rows represent SDK-spawned sub-agents associated with a parent run.

ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id) ON DELETE CASCADE;

CREATE INDEX idx_runs_parent ON runs(parent_run_id);