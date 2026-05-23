import type { Database as BetterSqlite3Database } from "better-sqlite3";

// Retention job — spec §8 → Retention Policy. Only prunes raw_json on events
// belonging to runs in a terminal status whose created_at is older than
// settings.rawEventRetentionDays. Canonical payload_json is never deleted.

export interface RetentionResult {
  /** Number of event rows whose raw_json was nulled. */
  prunedCount: number;
  /** Sum of raw_bytes for the pruned rows BEFORE this run. */
  reclaimedBytes: number;
  /** Retention cutoff (ISO-8601 UTC). */
  cutoff: string;
}

const TERMINAL_STATUSES = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"] as const;

function readRetentionDays(raw: BetterSqlite3Database, fallback: number): number {
  const row = raw
    .prepare("SELECT value_json FROM settings WHERE key = 'rawEventRetentionDays'")
    .get() as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    const parsed = JSON.parse(row.value_json);
    if (typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  } catch {
    // Fall through to fallback.
  }
  return fallback;
}

export function pruneRawEventJson(
  raw: BetterSqlite3Database,
  now: Date = new Date(),
): RetentionResult {
  const retentionDays = readRetentionDays(raw, 180);
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const sizeRow = raw
    .prepare(
      `SELECT COALESCE(SUM(raw_bytes), 0) AS bytes, COUNT(*) AS count
         FROM events
        WHERE raw_json IS NOT NULL
          AND created_at < ?
          AND run_id IN (
                SELECT id FROM runs WHERE status IN (${TERMINAL_STATUSES.map(() => "?").join(", ")})
              )`,
    )
    .get(cutoff, ...TERMINAL_STATUSES) as { bytes: number; count: number };

  if (sizeRow.count === 0) {
    return { prunedCount: 0, reclaimedBytes: 0, cutoff };
  }

  const update = raw.prepare(
    `UPDATE events
        SET raw_json = NULL,
            raw_bytes = 0
      WHERE raw_json IS NOT NULL
        AND created_at < ?
        AND run_id IN (
              SELECT id FROM runs WHERE status IN (${TERMINAL_STATUSES.map(() => "?").join(", ")})
            )`,
  );
  const result = update.run(cutoff, ...TERMINAL_STATUSES);

  return {
    prunedCount: Number(result.changes),
    reclaimedBytes: sizeRow.bytes,
    cutoff,
  };
}
