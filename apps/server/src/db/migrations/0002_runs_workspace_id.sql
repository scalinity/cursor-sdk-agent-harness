-- Phase 17 — link runs to the workspace active at creation time.
-- Enables the sessions rail to group chats under their workspace. The column
-- is nullable: pre-existing runs (and any run created without an active
-- workspace) carry NULL and surface under an "Unassigned" group in the UI.

ALTER TABLE runs ADD COLUMN workspace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_workspace_id_started_at
  ON runs (workspace_id, started_at);