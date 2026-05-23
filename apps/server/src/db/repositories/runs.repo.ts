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

export interface RunHistoryRow extends RunRow {
  agentName: string | null;
  toolCallCount: number;
  errorToolCallCount: number;
}

export interface RunHistoryListOptions {
  agentId?: string;
  agentIds?: string[];
  statuses?: string[];
  modelIds?: string[];
  from?: string;
  to?: string;
  hasCost?: "any" | "available" | "unavailable" | "none";
  sort?: "started_desc" | "started_asc" | "duration_desc" | "duration_asc" | "cost_desc" | "cost_asc" | "tokens_desc" | "tokens_asc";
  limit?: number;
  offset?: number;
}

interface RunHistoryDbRow extends RunDbRow {
  agent_name: string | null;
  tool_call_count: number | null;
  error_tool_call_count: number | null;
}

export interface UsageRangeOptions {
  from?: string;
  to?: string;
  agentId?: string;
  modelId?: string;
}

export interface UsageSummaryAggregate {
  totalRuns: number;
  totalCost: number;
  totalTokens: number;
  unavailableCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalReasoningTokens: number;
  totalCostUsdMicros: number;
  bySource: Record<UsageSource, number>;
}

export interface UsageDailyAggregate {
  date: string;
  cost: number;
  tokens: number;
}

export interface UsageBreakdownAggregate {
  id: string;
  name: string;
  runs: number;
  cost: number;
  tokens: number;
}

function historyRowToDomain(row: RunHistoryDbRow): RunHistoryRow {
  return {
    ...rowToDomain(row),
    agentName: row.agent_name,
    toolCallCount: row.tool_call_count ?? 0,
    errorToolCallCount: row.error_tool_call_count ?? 0,
  };
}

function appendInClause(sql: string[], params: unknown[], column: string, values: string[] | undefined): void {
  if (!values || values.length === 0) return;
  const placeholders = values.map(() => "?").join(", ");
  sql.push(`${column} IN (${placeholders})`);
  params.push(...values);
}

function appendUsageRange(sql: string[], params: unknown[], opts: UsageRangeOptions): void {
  if (opts.from !== undefined) {
    sql.push("r.started_at >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    sql.push("r.started_at <= ?");
    params.push(opts.to);
  }
  if (opts.agentId !== undefined) {
    sql.push("r.agent_id = ?");
    params.push(opts.agentId);
  }
  if (opts.modelId !== undefined) {
    sql.push("r.model_id = ?");
    params.push(opts.modelId);
  }
}

function rowNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rowToUsageTokens(row: {
  total_input: number | null;
  total_output: number | null;
  total_cached: number | null;
  total_reasoning: number | null;
}): number {
  void row.total_cached;
  void row.total_reasoning;
  return rowNumber(row.total_input) + rowNumber(row.total_output);
}

function orderByForRunHistory(sort: NonNullable<RunHistoryListOptions["sort"]>, alias = "r"): string {
  switch (sort) {
    case "started_asc":
      return `${alias}.started_at ASC`;
    case "duration_desc":
      return `${alias}.duration_ms IS NULL ASC, ${alias}.duration_ms DESC, ${alias}.started_at DESC`;
    case "duration_asc":
      return `${alias}.duration_ms IS NULL ASC, ${alias}.duration_ms ASC, ${alias}.started_at DESC`;
    case "cost_desc":
      return `${alias}.cost_usd_micros IS NULL ASC, ${alias}.cost_usd_micros DESC, ${alias}.started_at DESC`;
    case "cost_asc":
      return `${alias}.cost_usd_micros IS NULL ASC, ${alias}.cost_usd_micros ASC, ${alias}.started_at DESC`;
    case "tokens_desc":
      return `(${alias}.input_tokens IS NULL AND ${alias}.output_tokens IS NULL) ASC, (COALESCE(${alias}.input_tokens, 0) + COALESCE(${alias}.output_tokens, 0)) DESC, ${alias}.started_at DESC`;
    case "tokens_asc":
      return `(${alias}.input_tokens IS NULL AND ${alias}.output_tokens IS NULL) ASC, (COALESCE(${alias}.input_tokens, 0) + COALESCE(${alias}.output_tokens, 0)) ASC, ${alias}.started_at DESC`;
    case "started_desc":
    default:
      return `${alias}.started_at DESC`;
  }
}

function buildRunHistoryWhere(opts: RunHistoryListOptions): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const agentIds = opts.agentIds ?? (opts.agentId !== undefined ? [opts.agentId] : undefined);
  appendInClause(parts, params, "r.agent_id", agentIds);
  appendInClause(parts, params, "r.status", opts.statuses);
  appendInClause(parts, params, "r.model_id", opts.modelIds);
  if (opts.from !== undefined) {
    parts.push("r.started_at >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    parts.push("r.started_at <= ?");
    params.push(opts.to);
  }
  if (opts.hasCost === "available") {
    parts.push("r.cost_usd_micros IS NOT NULL AND r.usage_source != 'unavailable'");
  } else if (opts.hasCost === "unavailable") {
    parts.push("r.usage_source = 'unavailable'");
  } else if (opts.hasCost === "none") {
    parts.push("r.cost_usd_micros IS NULL AND r.usage_source IS NULL");
  }
  return { clause: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}

function buildUsageWhere(opts: UsageRangeOptions): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  appendUsageRange(parts, params, opts);
  return { clause: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}

function rowToSource(value: unknown): UsageSource {
  if (value === "sdk_final_result" || value === "derived" || value === "unavailable") {
    return value;
  }
  return "unavailable";
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

  /**
   * Total row count matching the same optional `agentId` filter as `list`.
   * Used by `GET /api/runs` to populate the pagination total — `list`
   * returns the current page, this returns the matching size of the
   * underlying set. Cheap (`COUNT(*)` over the runs PK index).
   */
  count(opts: { agentId?: string } = {}): number {
    if (opts.agentId !== undefined) {
      const row = this.raw
        .prepare("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ?")
        .get(opts.agentId) as { n: number };
      return row.n;
    }
    const row = this.raw
      .prepare("SELECT COUNT(*) AS n FROM runs")
      .get() as { n: number };
    return row.n;
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

  listHistory(opts: RunHistoryListOptions = {}): { items: RunHistoryRow[]; total: number } {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const where = buildRunHistoryWhere(opts);
    const countRow = this.raw
      .prepare(`SELECT COUNT(*) AS n FROM runs r ${where.clause}`)
      .get(...where.params) as { n: number };
    const rows = this.raw
      .prepare(
        `WITH page AS (
           SELECT r.*
             FROM runs r
            ${where.clause}
            ORDER BY ${orderByForRunHistory(opts.sort ?? "started_desc", "r")}
            LIMIT ? OFFSET ?
         )
         SELECT page.*,
                a.name AS agent_name,
                COALESCE(ec.tool_call_count, 0) AS tool_call_count,
                COALESCE(ec.error_tool_call_count, 0) AS error_tool_call_count
           FROM page
           LEFT JOIN agents a ON a.id = page.agent_id
           LEFT JOIN (
             SELECT e.run_id,
                    COUNT(*) AS tool_call_count,
                    SUM(CASE WHEN e.kind = 'tool_call.error' OR e.status = 'error' THEN 1 ELSE 0 END) AS error_tool_call_count
               FROM events e
               INNER JOIN page p ON p.id = e.run_id
              WHERE e.kind LIKE 'tool_call.%'
              GROUP BY e.run_id
           ) ec ON ec.run_id = page.id
          ORDER BY ${orderByForRunHistory(opts.sort ?? "started_desc", "page")}`,
      )
      .all(...where.params, limit, offset) as RunHistoryDbRow[];
    return { items: rows.map(historyRowToDomain), total: countRow.n };
  }

  usageSummary(opts: UsageRangeOptions = {}): UsageSummaryAggregate {
    const where = buildUsageWhere(opts);
    const row = this.raw
      .prepare(
        `SELECT COUNT(*) AS total_runs,
                COALESCE(SUM(cost_usd_micros), 0) AS total_cost,
                COALESCE(SUM(input_tokens), 0) AS total_input,
                COALESCE(SUM(output_tokens), 0) AS total_output,
                COALESCE(SUM(cached_input_tokens), 0) AS total_cached,
                COALESCE(SUM(reasoning_tokens), 0) AS total_reasoning,
                SUM(CASE WHEN usage_source = 'unavailable' THEN 1 ELSE 0 END) AS unavailable_count
           FROM runs r
          ${where.clause}`,
      )
      .get(...where.params) as {
      total_runs: number;
      total_cost: number | null;
      total_input: number | null;
      total_output: number | null;
      total_cached: number | null;
      total_reasoning: number | null;
      unavailable_count: number | null;
    };
    const sourceRows = this.raw
      .prepare(
        `SELECT COALESCE(usage_source, 'unavailable') AS usage_source, COUNT(*) AS n
           FROM runs r
          ${where.clause}
          GROUP BY COALESCE(usage_source, 'unavailable')`,
      )
      .all(...where.params) as Array<{ usage_source: string | null; n: number }>;
    const bySource: Record<UsageSource, number> = {
      sdk_final_result: 0,
      derived: 0,
      unavailable: 0,
    };
    for (const sourceRow of sourceRows) {
      bySource[rowToSource(sourceRow.usage_source)] += sourceRow.n;
    }
    return {
      totalRuns: rowNumber(row.total_runs),
      totalCost: rowNumber(row.total_cost),
      totalTokens: rowToUsageTokens(row),
      unavailableCount: rowNumber(row.unavailable_count),
      totalInputTokens: rowNumber(row.total_input),
      totalOutputTokens: rowNumber(row.total_output),
      totalCachedInputTokens: rowNumber(row.total_cached),
      totalReasoningTokens: rowNumber(row.total_reasoning),
      totalCostUsdMicros: rowNumber(row.total_cost),
      bySource,
    };
  }

  usageDaily(opts: UsageRangeOptions = {}): UsageDailyAggregate[] {
    const where = buildUsageWhere(opts);
    const rows = this.raw
      .prepare(
        `SELECT substr(r.started_at, 1, 10) AS day,
                COALESCE(SUM(r.cost_usd_micros), 0) AS total_cost,
                COALESCE(SUM(r.input_tokens), 0) AS total_input,
                COALESCE(SUM(r.output_tokens), 0) AS total_output,
                COALESCE(SUM(r.cached_input_tokens), 0) AS total_cached,
                COALESCE(SUM(r.reasoning_tokens), 0) AS total_reasoning
           FROM runs r
          ${where.clause}
          GROUP BY substr(r.started_at, 1, 10)
          ORDER BY day ASC`,
      )
      .all(...where.params) as Array<{
      day: string;
      total_cost: number | null;
      total_input: number | null;
      total_output: number | null;
      total_cached: number | null;
      total_reasoning: number | null;
    }>;
    return rows.map((row) => ({
      date: row.day,
      cost: rowNumber(row.total_cost),
      tokens: rowToUsageTokens(row),
    }));
  }

  usageByModel(opts: UsageRangeOptions = {}): UsageBreakdownAggregate[] {
    const where = buildUsageWhere(opts);
    const rows = this.raw
      .prepare(
        `SELECT COALESCE(r.model_id, 'unknown') AS id,
                COALESCE(r.model_id, 'unknown') AS name,
                COUNT(*) AS runs,
                COALESCE(SUM(r.cost_usd_micros), 0) AS total_cost,
                COALESCE(SUM(r.input_tokens), 0) AS total_input,
                COALESCE(SUM(r.output_tokens), 0) AS total_output,
                COALESCE(SUM(r.cached_input_tokens), 0) AS total_cached,
                COALESCE(SUM(r.reasoning_tokens), 0) AS total_reasoning
           FROM runs r
          ${where.clause}
          GROUP BY COALESCE(r.model_id, 'unknown')
          ORDER BY total_cost DESC, runs DESC, name ASC`,
      )
      .all(...where.params) as Array<{
      id: string;
      name: string;
      runs: number;
      total_cost: number | null;
      total_input: number | null;
      total_output: number | null;
      total_cached: number | null;
      total_reasoning: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      runs: rowNumber(row.runs),
      cost: rowNumber(row.total_cost),
      tokens: rowToUsageTokens(row),
    }));
  }

  usageByAgent(opts: UsageRangeOptions = {}): UsageBreakdownAggregate[] {
    const where = buildUsageWhere(opts);
    const rows = this.raw
      .prepare(
        `SELECT r.agent_id AS id,
                COALESCE(a.name, r.agent_id) AS name,
                COUNT(*) AS runs,
                COALESCE(SUM(r.cost_usd_micros), 0) AS total_cost,
                COALESCE(SUM(r.input_tokens), 0) AS total_input,
                COALESCE(SUM(r.output_tokens), 0) AS total_output,
                COALESCE(SUM(r.cached_input_tokens), 0) AS total_cached,
                COALESCE(SUM(r.reasoning_tokens), 0) AS total_reasoning
           FROM runs r
           LEFT JOIN agents a ON a.id = r.agent_id
          ${where.clause}
          GROUP BY r.agent_id, COALESCE(a.name, r.agent_id)
          ORDER BY total_cost DESC, runs DESC, name ASC`,
      )
      .all(...where.params) as Array<{
      id: string;
      name: string;
      runs: number;
      total_cost: number | null;
      total_input: number | null;
      total_output: number | null;
      total_cached: number | null;
      total_reasoning: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      runs: rowNumber(row.runs),
      cost: rowNumber(row.total_cost),
      tokens: rowToUsageTokens(row),
    }));
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
   *
   * Precision note: better-sqlite3 returns `SUM(cost_usd_micros)` as a JS
   * `number`. Cost is stored in integer micro-USD, so the safe-integer
   * cap (2^53 ≈ 9.007e15) corresponds to roughly $9.007 billion in total
   * cost per agent. Single-user local workloads are nowhere near this,
   * so we treat the precision as acceptable for v1; if the harness ever
   * grows to multi-tenant or aggregate-across-tenants reporting, swap to
   * `better-sqlite3`'s `safeIntegers` mode and BigInt arithmetic.
   */
  /**
   * Per-agent aggregates for a single agent. Same shape as one row of
   * `aggregatesByAgent()` but filters in SQL so we don't scan all runs
   * for a `getById` request. Returns null when the agent has zero runs
   * (caller substitutes zeros for missing keys per the same convention
   * as `aggregatesByAgent`).
   */
  aggregatesForAgent(agentId: string): {
    runCount: number;
    activeRunCount: number;
    totalCostUsdMicros: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } | null {
    const row = this.raw
      .prepare(
        `SELECT COUNT(*)                                            AS run_count,
                SUM(CASE WHEN status IN ('CREATING','RUNNING') THEN 1 ELSE 0 END) AS active_run_count,
                COALESCE(SUM(cost_usd_micros), 0)                   AS total_cost,
                COALESCE(SUM(input_tokens), 0)                      AS total_input,
                COALESCE(SUM(output_tokens), 0)                     AS total_output
           FROM runs
          WHERE agent_id = ?`,
      )
      .get(agentId) as
      | {
          run_count: number;
          active_run_count: number;
          total_cost: number;
          total_input: number;
          total_output: number;
        }
      | undefined;
    if (!row || row.run_count === 0) return null;
    return {
      runCount: row.run_count,
      activeRunCount: row.active_run_count,
      totalCostUsdMicros: row.total_cost,
      totalInputTokens: row.total_input,
      totalOutputTokens: row.total_output,
    };
  }

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
