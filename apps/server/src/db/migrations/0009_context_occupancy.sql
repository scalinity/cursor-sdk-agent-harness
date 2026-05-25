-- Context management — persist the LAST turn's token usage per run.
--
-- The existing input_tokens/output_tokens columns hold the SUMMED billing total
-- across all turns of a run (accumulateTurnEndedUsage). That can far exceed the
-- model's context window over a long multi-turn run, so it is useless for a
-- context-fill gauge. These columns store the most recent turn's per-turn usage,
-- which already includes all prior context the model re-ingested — the best
-- estimate of how full the window is right now. It also DROPS when Composer
-- self-summarizes mid-session (cursor.com/blog/self-summarization), which the
-- UI surfaces. Both nullable: NULL when the SDK delivered no usage.
ALTER TABLE runs ADD COLUMN last_turn_input_tokens INTEGER;
ALTER TABLE runs ADD COLUMN last_turn_output_tokens INTEGER;
