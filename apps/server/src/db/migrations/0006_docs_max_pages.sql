-- Phase 22 follow-up (P22-W1): persist the per-source crawl page limit.
-- Additive migration rather than editing 0005, so databases that already
-- applied 0005 pick up the column on next launch (migrations are immutable
-- once applied).
ALTER TABLE docs_sources ADD COLUMN max_pages INTEGER NOT NULL DEFAULT 100;
