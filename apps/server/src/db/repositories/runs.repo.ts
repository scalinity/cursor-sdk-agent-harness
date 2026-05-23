import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AgentMode,
  RunRow,
  SdkRunStatus,
  TokenUsage,
  UsageSource,
} from "@harness/shared";
import { isoNow, parseJsonOrNull, stringifyOrNull } from "./mapping.js";

export interface CreateRunInput {
  id?: string;
  agentId: string;
  status: SdkRunStatus;
  promptPreview?: string;
  modelId?: string | null;
  mode?: AgentMode | null;
}

export interface SetFinalResultInput {
  finalText: string | null;
  finalResult: unknown;
  gitMetadata: unknown;
  durationMs: number | null;
}

interface RunDbRow {
  id: string;
  agent_id: string;
  status: string;
  prompt_preview: string;
  model_id: string | null;
  mode: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  last_seq: number;
  final_text: string | null;
  final_result_json: string | null;
  git_metadata_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd_micros: number | null;
  usage_source: string | null;
  error_json: string | null;
  interrupted_reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: RunDbRow): RunRow {
  return {
    id: row.id,
    agentId: row.agent_id,
    status: row.status as SdkRunStatus,
    promptPreview: row.prompt_preview,
    modelId: row.model_id,
    mode: row.mode === null ? null : (row.mode as AgentMode),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    lastSeq: row.last_seq,
    finalText: row.final_text,
    finalResult: parseJsonOrNull(row.final_result_json),
    gitMetadata: parseJsonOrNull(row.git_metadata_json),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedInputTokens: row.cached_input_tokens,
    reasoningTokens: row.reasoning_tokens,
    costUsdMicros: row.cost_usd_micros,
    usageSource: row.usage_source === null ? null : (row.usage_source as UsageSource),
    error: parseJsonOrNull(row.error_json),
    interruptedReason: row.interrupted_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RunsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  create(input: CreateRunInput): RunRow {
    const id = input.id ?? randomUUID();
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO runs (
            id, agent_id, status, prompt_preview, model_id, mode,
            started_at, last_seq, created_at, updated_at
          ) VALUES (
            @id, @agent_id, @status, @prompt_preview, @model_id, @mode,
            @started_at, 0, @created_at, @updated_at
          )`,
      )
      .run({
        id,
        agent_id: input.agentId,
        status: input.status,
        prompt_preview: input.promptPreview ?? "",
        model_id: input.modelId ?? null,
        mode: input.mode ?? null,
        started_at: now,
        created_at: now,
        updated_at: now,
      });
    const row = this.getById(id);
    if (!row) {
      throw new Error(`RunsRepo.create: inserted row not found for id=${id}`);
    }
    return row;
  }

  getById(id: string): RunRow | null {
    const row = this.raw
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as RunDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  list(opts: { agentId?: string; limit?: number; offset?: number } = {}): RunRow[] {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    if (opts.agentId !== undefined) {
      const rows = this.raw
        .prepare(
          "SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
        )
        .all(opts.agentId, limit, offset) as RunDbRow[];
      return rows.map(rowToDomain);
    }
    const rows = this.raw
      .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as RunDbRow[];
    return rows.map(rowToDomain);
  }

  updateStatus(id: string, status: SdkRunStatus, error?: unknown): void {
    this.raw
      .prepare(
        `UPDATE runs
            SET status = ?,
                error_json = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(status, stringifyOrNull(error ?? null), isoNow(), id);
  }

  setFinalResult(id: string, input: SetFinalResultInput): void {
    const now = isoNow();
    // Guard against late-arriving wait() resolutions overwriting a row that
    // was already finalised by a cancel or crash-recovery interrupt. The
    // consume loop calls this unconditionally after `run.wait()`; we refuse
    // to clobber a CANCELLED/EXPIRED/ERROR status's diagnostic columns.
    this.raw
      .prepare(
        `UPDATE runs
            SET final_text = ?,
                final_result_json = ?,
                git_metadata_json = ?,
                duration_ms = ?,
                finished_at = ?,
                updated_at = ?
          WHERE id = ?
            AND status NOT IN ('CANCELLED', 'ERROR', 'EXPIRED')`,
      )
      .run(
        input.finalText,
        stringifyOrNull(input.finalResult),
        stringifyOrNull(input.gitMetadata),
        input.durationMs,
        now,
        now,
        id,
      );
  }

  setUsage(id: string, usage: TokenUsage): void {
    // Usage may legitimately arrive for a CANCELLED or ERROR run (the SDK
    // emits turn-ended usage even when the user aborted mid-turn), so we
    // allow CANCELLED/ERROR here but refuse to overwrite EXPIRED rows that
    // pre-date this process (crash-recovery write).
    this.raw
      .prepare(
        `UPDATE runs
            SET input_tokens = ?,
                output_tokens = ?,
                cached_input_tokens = ?,
                reasoning_tokens = ?,
                cost_usd_micros = ?,
                usage_source = ?,
                updated_at = ?
          WHERE id = ?
            AND status NOT IN ('EXPIRED')`,
      )
      .run(
        usage.input_tokens,
        usage.output_tokens,
        usage.cached_input_tokens,
        usage.reasoning_tokens,
        usage.cost_usd_micros,
        usage.usage_source,
        isoNow(),
        id,
      );
  }

  /**
   * Single transactional finalize: writes status + final-result columns +
   * usage in one UPDATE wrapped in `db.transaction(...)`. Replaces the
   * previous three-call sequence in RunController.consumeAndFinalise so a
   * crash between any two writes can't leave the row half-finished.
   *
   * Status guard matches setFinalResult (don't clobber CANCELLED/ERROR/
   * EXPIRED), since the same race is possible.
   */
  finalize(
    id: string,
    input: {
      status: SdkRunStatus;
      finalText: string | null;
      finalResult: unknown;
      gitMetadata: unknown;
      durationMs: number | null;
      usage: TokenUsage;
    },
  ): void {
    const now = isoNow();
    this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE runs
              SET status = ?,
                  final_text = ?,
                  final_result_json = ?,
                  git_metadata_json = ?,
                  duration_ms = ?,
                  input_tokens = ?,
                  output_tokens = ?,
                  cached_input_tokens = ?,
                  reasoning_tokens = ?,
                  cost_usd_micros = ?,
                  usage_source = ?,
                  finished_at = COALESCE(finished_at, ?),
                  updated_at = ?
            WHERE id = ?
              AND status NOT IN ('CANCELLED', 'ERROR', 'EXPIRED')`,
        )
        .run(
          input.status,
          input.finalText,
          stringifyOrNull(input.finalResult),
          stringifyOrNull(input.gitMetadata),
          input.durationMs,
          input.usage.input_tokens,
          input.usage.output_tokens,
          input.usage.cached_input_tokens,
          input.usage.reasoning_tokens,
          input.usage.cost_usd_micros,
          input.usage.usage_source,
          now,
          now,
          id,
        );
    })();
  }

  /**
   * Mark a non-terminal run as CANCELLED in response to a verified SDK
   * cancellation (e.g. `Run.cancel()` resolved). Distinct from
   * `setInterrupted` because the latter writes `status='ERROR'` and is
   * reserved for error-y interruption (stream errors, server crash
   * recovery). No-op when the run is already in a terminal status.
   *
   * Spec §11 cancellation contract step 5–6: the harness sets CANCELLED
   * only when the SDK confirms it — this method is the write path for that
   * confirmation.
   */
  setCancelled(id: string, reason: string): void {
    const now = isoNow();
    this.raw
      .prepare(
        `UPDATE runs
            SET status = 'CANCELLED',
                interrupted_reason = ?,
                updated_at = ?,
                finished_at = COALESCE(finished_at, ?)
          WHERE id = ?
            AND status IN ('CREATING', 'RUNNING')`,
      )
      .run(reason, now, now, id);
  }

  /**
   * Mark a non-terminal run as ERROR with the supplied interruption reason.
   * No-op when the run is already in a terminal status (FINISHED/ERROR/
   * CANCELLED/EXPIRED) — see spec §11 Mid-run Server Crash Recovery: the
   * caller's first step is to query non-terminal runs, and we refuse to
   * rewrite already-finalised rows defensively.
   */
  setInterrupted(id: string, reason: string, message?: string | null): void {
    const now = isoNow();
    this.raw
      .prepare(
        `UPDATE runs
            SET status = 'ERROR',
                interrupted_reason = ?,
                error_json = ?,
                updated_at = ?,
                finished_at = COALESCE(finished_at, ?)
          WHERE id = ?
            AND status IN ('CREATING', 'RUNNING')`,
      )
      .run(
        reason,
        message ? JSON.stringify({ message }) : null,
        now,
        now,
        id,
      );
  }

  /**
   * Allocate the next sequence number for a run. Must be called inside the
   * same DB transaction that inserts the canonical event row.
   */
  incrementLastSeq(id: string): number {
    const row = this.raw
      .prepare(
        "UPDATE runs SET last_seq = last_seq + 1, updated_at = ? WHERE id = ? RETURNING last_seq",
      )
      .get(isoNow(), id) as { last_seq: number } | undefined;
    if (!row) {
      throw new Error(`RunsRepo.incrementLastSeq: run not found id=${id}`);
    }
    return row.last_seq;
  }

  delete(id: string): void {
    this.raw.prepare("DELETE FROM runs WHERE id = ?").run(id);
  }

  getLatestForAgent(agentId: string): RunRow | null {
    const row = this.raw
      .prepare(
        "SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1",
      )
      .get(agentId) as RunDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  /**
   * Per-agent aggregates used by the Agent Picker and `/api/agents`. Returns
   * one row per agent_id; agents with zero runs are NOT included — the caller
   * (AgentRuntime.list) joins this against the agents table and substitutes
   * zeros for missing keys so a freshly-created agent renders correctly.
   */
  aggregatesByAgent(): Map<
    string,
    {
      runCount: number;
      activeRunCount: number;
      totalCostUsdMicros: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    }
  > {
    const rows = this.raw
      .prepare(
        `SELECT agent_id,
                COUNT(*)                                            AS run_count,
                SUM(CASE WHEN status IN ('CREATING','RUNNING') THEN 1 ELSE 0 END) AS active_run_count,
                COALESCE(SUM(cost_usd_micros), 0)                   AS total_cost,
                COALESCE(SUM(input_tokens), 0)                      AS total_input,
                COALESCE(SUM(output_tokens), 0)                     AS total_output
           FROM runs
          GROUP BY agent_id`,
      )
      .all() as Array<{
      agent_id: string;
      run_count: number;
      active_run_count: number;
      total_cost: number;
      total_input: number;
      total_output: number;
    }>;
    const out = new Map<
      string,
      {
        runCount: number;
        activeRunCount: number;
        totalCostUsdMicros: number;
        totalInputTokens: number;
        totalOutputTokens: number;
      }
    >();
    for (const r of rows) {
      out.set(r.agent_id, {
        runCount: r.run_count,
        activeRunCount: r.active_run_count,
        totalCostUsdMicros: r.total_cost,
        totalInputTokens: r.total_input,
        totalOutputTokens: r.total_output,
      });
    }
    return out;
  }
}
