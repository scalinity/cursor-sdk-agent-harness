-- Phase 20: Context Intelligence
-- Stores which @-mentions were resolved and included in a run's prompt context.
ALTER TABLE runs ADD COLUMN context_metadata TEXT
  CHECK (context_metadata IS NULL OR json_valid(context_metadata));
