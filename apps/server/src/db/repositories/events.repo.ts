import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type {
  CanonicalEventBase,
  EventRow,
  EventSdkType,
} from "@harness/shared";
import { isoNow, parseJsonOrNull, stringifyOrNull } from "./mapping.js";

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

function rowToDomain(row: EventDbRow): EventRow {
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
    payload: JSON.parse(row.payload_json),
    raw: parseJsonOrNull(row.raw_json),
    payloadBytes: row.payload_bytes,
    rawBytes: row.raw_bytes,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  };
}

export class EventsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  /**
   * Allocate the next sequence number for the run and insert the canonical
   * event row atomically. The repository owns the transaction so that
   * concurrent callers can never produce gapped or duplicate seq values.
   */
  appendCanonicalEvent(event: AppendableEvent): EventRow {
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
