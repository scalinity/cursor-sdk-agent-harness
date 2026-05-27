import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type {
  CanonicalEventBase,
  EventRow,
  EventSdkType,
} from "@harness/shared";
import { isoNow, parseJsonOrNull, stringifyOrNull } from "./mapping.js";
import { LARGE_PAYLOAD_THRESHOLD_BYTES } from "@harness/shared";

// AppendableEvent — the input shape callers hand to appendCanonicalEvent.
// `seq` is intentionally omitted; the repository allocates it atomically from
// runs.last_seq within the surrounding transaction.
export interface AppendableEvent {
  id?: string;
  runId: string;
  agentId: string;
  sdkType: EventSdkType;
  kind: string;
  callId?: string | null;
  requestId?: string | null;
  status?: string | null;
  payload: unknown;
  raw?: unknown;
  occurredAt: string;
  receivedAt?: string;
}

export interface RecentEventPreviewRow {
  seq: number;
  kind: string;
  status: string | null;
  payload: unknown;
  occurredAt: string;
}

interface EventDbRow {
  id: string;
  run_id: string;
  agent_id: string;
  seq: number;
  schema_version: number;
  sdk_type: string;
  kind: string;
  call_id: string | null;
  request_id: string | null;
  status: string | null;
  payload_json: string;
  raw_json: string | null;
  payload_bytes: number;
  raw_bytes: number;
  occurred_at: string;
  received_at: string;
  created_at: string;
}

interface ReplayEventDbRow extends EventDbRow {
  replay_call_id: string | null;
  replay_name: string | null;
  replay_status: string | null;
  replay_truncated_json: string | null;
  replay_timing_json: string | null;
  replay_has_args: 0 | 1 | null;
  replay_has_result: 0 | 1 | null;
}

interface ToolCallReplayPayload {
  call_id: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  truncated?: { args?: boolean; result?: boolean };
  timing?: { started_at?: string; completed_at?: string; duration_ms?: number };
}

function parseReplayJsonObject<T extends object>(json: string | null): T | undefined {
  if (json === null) return undefined;
  const parsed = JSON.parse(json) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as T)
    : undefined;
}

function rowMetadata(row: EventDbRow): Omit<EventRow, "payload" | "raw"> {
  return {
    id: row.id,
    runId: row.run_id,
    agentId: row.agent_id,
    seq: row.seq,
    schemaVersion: row.schema_version as 1,
    sdkType: row.sdk_type as EventSdkType,
    kind: row.kind,
    callId: row.call_id,
    requestId: row.request_id,
    status: row.status,
    payloadBytes: row.payload_bytes,
    rawBytes: row.raw_bytes,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  };
}

function rowToDomain(row: EventDbRow): EventRow {
  return {
    ...rowMetadata(row),
    payload: JSON.parse(row.payload_json),
    raw: parseJsonOrNull(row.raw_json),
  };
}

function rowToReplayDomain(row: ReplayEventDbRow): EventRow {
  const shouldSlim =
    row.sdk_type === "tool_call" &&
    row.payload_bytes > LARGE_PAYLOAD_THRESHOLD_BYTES;
  if (!shouldSlim) return rowToDomain(row);

  const status = row.replay_status;
  if (
    typeof row.replay_call_id !== "string" ||
    typeof row.replay_name !== "string" ||
    (status !== "running" && status !== "completed" && status !== "error")
  ) {
    return rowToDomain(row);
  }

  const payload: ToolCallReplayPayload = {
    call_id: row.replay_call_id,
    name: row.replay_name,
    status,
  };
  if (row.replay_has_args === 1) payload.args = null;
  if (row.replay_has_result === 1) payload.result = null;
  const truncated = parseReplayJsonObject<ToolCallReplayPayload["truncated"] & object>(
    row.replay_truncated_json,
  );
  if (truncated !== undefined) payload.truncated = truncated;
  const timing = parseReplayJsonObject<ToolCallReplayPayload["timing"] & object>(
    row.replay_timing_json,
  );
  if (timing !== undefined) payload.timing = timing;

  return {
    ...rowMetadata(row),
    payload,
    raw: row.raw_bytes > 0 ? {} : null,
  };
}

export class EventsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  /**
   * Allocate the next sequence number for the run and insert the canonical
   * event row atomically. The repository owns the transaction so that
   * concurrent callers can never produce gapped or duplicate seq values.
   */
  appendCanonicalEvent(event: AppendableEvent, beforeCommit?: () => void): EventRow {
    const id = event.id ?? randomUUID();
    const receivedAt = event.receivedAt ?? isoNow();
    const payloadJson = JSON.stringify(event.payload ?? null);
    const rawJson = stringifyOrNull(event.raw ?? null);
    const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
    const rawBytes = rawJson === null ? 0 : Buffer.byteLength(rawJson, "utf8");

    const insert = this.raw.prepare(
      `INSERT INTO events (
          id, run_id, agent_id, seq, sdk_type, kind,
          call_id, request_id, status,
          payload_json, raw_json,
          payload_bytes, raw_bytes,
          occurred_at, received_at
        ) VALUES (
          @id, @run_id, @agent_id, @seq, @sdk_type, @kind,
          @call_id, @request_id, @status,
          @payload_json, @raw_json,
          @payload_bytes, @raw_bytes,
          @occurred_at, @received_at
        )`,
    );

    const incrementSeq = this.raw.prepare(
      "UPDATE runs SET last_seq = last_seq + 1, updated_at = ? WHERE id = ? RETURNING last_seq",
    );

    const tx = this.raw.transaction(() => {
      const seqRow = incrementSeq.get(receivedAt, event.runId) as
        | { last_seq: number }
        | undefined;
      if (!seqRow) {
        throw new Error(
          `EventsRepo.appendCanonicalEvent: run not found id=${event.runId}`,
        );
      }
      beforeCommit?.();
      insert.run({
        id,
        run_id: event.runId,
        agent_id: event.agentId,
        seq: seqRow.last_seq,
        sdk_type: event.sdkType,
        kind: event.kind,
        call_id: event.callId ?? null,
        request_id: event.requestId ?? null,
        status: event.status ?? null,
        payload_json: payloadJson,
        raw_json: rawJson,
        payload_bytes: payloadBytes,
        raw_bytes: rawBytes,
        occurred_at: event.occurredAt,
        received_at: receivedAt,
      });
      return seqRow.last_seq;
    });

    tx();
    const stored = this.getById(id);
    if (!stored) {
      throw new Error(
        `EventsRepo.appendCanonicalEvent: inserted row not found for id=${id}`,
      );
    }
    return stored;
  }

  getById(id: string): EventRow | null {
    const row = this.raw
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(id) as EventDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  getPayloadById(id: string): { value: unknown; byteCount: number } | null {
    const row = this.raw
      .prepare("SELECT payload_json, payload_bytes FROM events WHERE id = ?")
      .get(id) as { payload_json: string; payload_bytes: number } | undefined;
    if (!row) return null;
    return { value: JSON.parse(row.payload_json), byteCount: row.payload_bytes };
  }

  getLargePayloadField(
    id: string,
    field: "args" | "result" | "raw",
  ): { value: unknown; byteCount: number } | null {
    if (field === "raw") {
      const row = this.raw
        .prepare("SELECT raw_json, raw_bytes FROM events WHERE id = ?")
        .get(id) as { raw_json: string | null; raw_bytes: number } | undefined;
      if (!row || row.raw_json === null) return null;
      return { value: JSON.parse(row.raw_json), byteCount: row.raw_bytes };
    }

    const row = this.raw
      .prepare("SELECT payload_json, payload_bytes FROM events WHERE id = ?")
      .get(id) as { payload_json: string; payload_bytes: number } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as Record<string, unknown>;
    if (!(field in payload)) {
      return null;
    }

    const value = payload[field];
    return { value, byteCount: Buffer.byteLength(JSON.stringify(value ?? null), "utf8") };
  }

  getRawById(id: string): { rawJson: string | null; rawBytes: number } | null {
    const row = this.raw
      .prepare("SELECT raw_json, raw_bytes FROM events WHERE id = ?")
      .get(id) as { raw_json: string | null; raw_bytes: number } | undefined;
    if (!row) return null;
    return { rawJson: row.raw_json, rawBytes: row.raw_bytes };
  }

  getByRunIdAfterSeq(
    runId: string,
    afterSeq: number,
    limit = 500,
  ): EventRow[] {
    const rows = this.raw
      .prepare(
        "SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
      )
      .all(runId, afterSeq, limit) as EventDbRow[];
    return rows.map(rowToDomain);
  }

  getReplayByRunIdAfterSeq(
    runId: string,
    afterSeq: number,
    limit = 500,
  ): EventRow[] {
    const rows = this.raw
      .prepare(
        `SELECT *,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.call_id') END AS replay_call_id,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.name') END AS replay_name,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.status') END AS replay_status,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.truncated') END AS replay_truncated_json,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.timing') END AS replay_timing_json,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold AND json_type(payload_json, '$.args') IS NOT NULL THEN 1 ELSE 0 END AS replay_has_args,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold AND json_type(payload_json, '$.result') IS NOT NULL THEN 1 ELSE 0 END AS replay_has_result
           FROM events
          WHERE run_id = @runId AND seq > @afterSeq
          ORDER BY seq ASC
          LIMIT @limit`,
      )
      .all({ runId, afterSeq, limit, threshold: LARGE_PAYLOAD_THRESHOLD_BYTES }) as ReplayEventDbRow[];
    return rows.map(rowToReplayDomain);
  }

  countByRunId(runId: string, afterSeq = 0): number {
    const row = this.raw
      .prepare("SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND seq > ?")
      .get(runId, afterSeq) as { n: number };
    return row.n;
  }

  getAllByRunId(runId: string): EventRow[] {
    const rows = this.raw
      .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY seq ASC")
      .all(runId) as EventDbRow[];
    return rows.map(rowToDomain);
  }

  getRecentPreviewByRunId(runId: string, limit = 5): RecentEventPreviewRow[] {
    const rows = this.raw
      .prepare(
        `SELECT seq, kind, status, payload_json, occurred_at
           FROM events
          WHERE run_id = ?
          ORDER BY seq DESC
          LIMIT ?`,
      )
      .all(runId, limit) as Array<{
      seq: number;
      kind: string;
      status: string | null;
      payload_json: string;
      occurred_at: string;
    }>;
    return rows.reverse().map((row) => ({
      seq: row.seq,
      kind: row.kind,
      status: row.status,
      payload: JSON.parse(row.payload_json),
      occurredAt: row.occurred_at,
    }));
  }

  /**
   * RV2-W3: focused lookup for the WS approval handler. Replaces a
   * full `getAllByRunId(runId)` + JS scan with a bounded indexed
   * query against `idx_events_request_id` (partial index on
   * `request_id IS NOT NULL`).
   *
   * Returns the originating `request.created` event's `agent_id` and
   * whether an outcome (`approval.resolved` / `approval.failed`)
   * already landed. The caller (`findPendingRequest`) routes:
   *   - `null` → no matching `request.created` row → APPROVAL_NOT_PENDING.
   *   - `{ hasOutcome: true }` → already resolved → APPROVAL_NOT_PENDING.
   *   - `{ hasOutcome: false }` → admit the approval.
   *
   * Only `(kind, agent_id)` is selected — payloads stay in the
   * database. Typical row count is 1–3 (request + at most one
   * outcome), so the in-JS pass over the result is O(1) for the
   * usable case.
   */
  getRequestState(
    runId: string,
    requestId: string,
  ): { agentId: string; hasOutcome: boolean } | null {
    const rows = this.raw
      .prepare(
        `SELECT kind, agent_id
           FROM events
          WHERE run_id = ?
            AND request_id = ?
            AND kind IN ('request.created', 'approval.resolved', 'approval.failed')`,
      )
      .all(runId, requestId) as Array<{ kind: string; agent_id: string }>;
    let requestRow: { agent_id: string } | null = null;
    let hasOutcome = false;
    for (const row of rows) {
      if (row.kind === "request.created") {
        requestRow = row;
      } else if (
        row.kind === "approval.resolved" ||
        row.kind === "approval.failed"
      ) {
        hasOutcome = true;
      }
    }
    if (!requestRow) return null;
    return { agentId: requestRow.agent_id, hasOutcome };
  }

  getByRunIdRange(
    runId: string,
    options: { fromSeq?: number; toSeq?: number; limit?: number; direction?: "asc" | "desc" } = {},
  ): EventRow[] {
    const fromSeq = options.fromSeq ?? 0;
    const toSeq = options.toSeq ?? Number.MAX_SAFE_INTEGER;
    const limit = options.limit ?? 500;
    const direction = options.direction === "desc" ? "DESC" : "ASC";
    const rows = this.raw
      .prepare(
        `SELECT * FROM events
           WHERE run_id = ? AND seq >= ? AND seq <= ?
           ORDER BY seq ${direction}
           LIMIT ?`,
      )
      .all(runId, fromSeq, toSeq, limit) as EventDbRow[];
    return rows.map(rowToDomain);
  }

  getReplayByRunIdRange(
    runId: string,
    options: { fromSeq?: number; toSeq?: number; limit?: number; direction?: "asc" | "desc" } = {},
  ): EventRow[] {
    const fromSeq = options.fromSeq ?? 0;
    const toSeq = options.toSeq ?? Number.MAX_SAFE_INTEGER;
    const limit = options.limit ?? 500;
    const direction = options.direction === "desc" ? "DESC" : "ASC";
    const rows = this.raw
      .prepare(
        `SELECT *,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.call_id') END AS replay_call_id,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.name') END AS replay_name,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.status') END AS replay_status,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.truncated') END AS replay_truncated_json,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold THEN json_extract(payload_json, '$.timing') END AS replay_timing_json,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold AND json_type(payload_json, '$.args') IS NOT NULL THEN 1 ELSE 0 END AS replay_has_args,
                CASE WHEN sdk_type = 'tool_call' AND payload_bytes > @threshold AND json_type(payload_json, '$.result') IS NOT NULL THEN 1 ELSE 0 END AS replay_has_result
           FROM events
          WHERE run_id = @runId AND seq >= @fromSeq AND seq <= @toSeq
          ORDER BY seq ${direction}
          LIMIT @limit`,
      )
      .all({
        runId,
        fromSeq,
        toSeq,
        limit,
        threshold: LARGE_PAYLOAD_THRESHOLD_BYTES,
      }) as ReplayEventDbRow[];
    return rows.map(rowToReplayDomain);
  }

  canonicalEventBaseFor(row: EventRow): CanonicalEventBase {
    return {
      event_id: row.id,
      schema_version: row.schemaVersion as 1,
      seq: row.seq,
      agent_id: row.agentId,
      run_id: row.runId,
      occurred_at: row.occurredAt,
      received_at: row.receivedAt,
    };
  }
}
