import { randomUUID } from "node:crypto";
import {
  type CanonicalEventKind,
  type EventRow,
  LARGE_PAYLOAD_THRESHOLD_BYTES,
  NON_BROADCAST_EVENT_KINDS,
  type ServerFrame,
} from "@harness/shared";

/**
 * REST endpoint template for lazy large-payload fetch. Phase 10
 * implements the route; we keep the template here next to its only
 * current emitter so the contract stays in one place. When Phase 10
 * adds the route, move this helper into a shared location (e.g.
 * apps/server/src/routes/events.routes.ts) and import it back.
 */
export function buildLargePayloadUrl(
  eventId: string,
  field: "args" | "result" | "raw",
): string {
  return `/api/events/${eventId}/large-payload/${field}`;
}

/**
 * Convert a persisted canonical event row into a server-side WS frame. The
 * resulting frame is Zod-checked at the boundary in the WS plugin; the
 * shapes below are written defensively so the validator passes for every
 * frame that lands here.
 *
 * Large-payload handling: tool_call frames whose serialised payload exceeds
 * `LARGE_PAYLOAD_THRESHOLD_BYTES` are sent with `large_payload_refs`
 * pointing at REST endpoints (`/api/events/:eventId/large-payload/:field`)
 * that fetch the full args / result / raw bytes lazily. Non-tool_call events
 * inline their payload regardless of size; in practice only assistant text
 * snapshots could approach the threshold, and the wire schema for assistant
 * frames has no large-payload-ref surface today.
 */
export interface BuildFrameOptions {
  /** When true, the frame's `replayed` semantic flag is set so clients can
   * distinguish historical events from live ones. Per spec §4 reconnection
   * contract, the flag governs autoscroll behaviour. */
  replayed?: boolean;
}

export function buildServerFrame(
  row: EventRow,
  opts: BuildFrameOptions = {},
): ServerFrame | null {
  const base = {
    event_id: row.id,
    schema_version: row.schemaVersion as 1,
    seq: row.seq,
    agent_id: row.agentId,
    run_id: row.runId,
    occurred_at: row.occurredAt,
    received_at: row.receivedAt,
  };
  const frameId = randomUUID();
  const sentAt = new Date().toISOString();
  // `replayed` is a first-class envelope field on `frameBaseSchema` (so
  // every server frame variant inherits it via `.extend()`). Clients can
  // read it without inspecting payload internals to decide autoscroll
  // behaviour. We only emit the key when true so live frames stay terse
  // on the wire.
  const replayedFlag = opts.replayed === true ? { replayed: true } : {};

  // Forensic-only kinds (e.g. system.unknown_sdk_message): row
  // persists but does not broadcast. Returning null is intentional;
  // the caller's frame validator does NOT log this branch.
  if (NON_BROADCAST_EVENT_KINDS.has(row.kind as CanonicalEventKind)) {
    return null;
  }

  // The switch below uses string-based discrimination for per-frame
  // type narrowing. The `default` branch contains an exhaustiveness
  // assertion against CanonicalEventKind: adding a new kind to the
  // shared schema without a `case` here will fail the typecheck on
  // the `_exhaustive: never` assignment rather than silently dropping
  // every event of the new kind via `return null`.
  switch (row.kind) {
    case "system.init":
      return {
        id: frameId,
        type: "sdk.system",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "system",
          kind: "system.init",
          payload: row.payload as never,
        },
      };
    case "user.message":
      return {
        id: frameId,
        type: "sdk.user",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "user",
          kind: "user.message",
          payload: row.payload as never,
        },
      };
    case "assistant.delta":
    case "assistant.snapshot":
      return {
        id: frameId,
        type: "sdk.assistant",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "assistant",
          kind: row.kind,
          payload: row.payload as never,
        },
      };
    case "thinking.delta":
    case "thinking.snapshot":
      return {
        id: frameId,
        type: "sdk.thinking",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "thinking",
          kind: row.kind,
          payload: row.payload as never,
        },
      };
    case "tool_call.running":
    case "tool_call.completed":
    case "tool_call.error": {
      const payload = buildToolCallPayload(row);
      return {
        id: frameId,
        type: "sdk.tool_call",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "tool_call",
          kind: row.kind,
          payload: payload as never,
        },
      };
    }
    case "status.changed":
      return {
        id: frameId,
        type: "sdk.status",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "status",
          kind: "status.changed",
          payload: row.payload as never,
        },
      };
    case "task.updated":
      return {
        id: frameId,
        type: "sdk.task",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "task",
          kind: "task.updated",
          payload: row.payload as never,
        },
      };
    case "request.created":
      return {
        id: frameId,
        type: "sdk.request",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "request",
          kind: "request.created",
          payload: row.payload as never,
        },
      };
    case "code_edit.detected":
      return {
        id: frameId,
        type: "derived.code_edit",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "tool_call",
          kind: "code_edit.detected",
          payload: row.payload as never,
        },
      };
    case "run.final_result":
      return {
        id: frameId,
        type: "run.final_result",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "status",
          kind: "run.final_result",
          payload: row.payload as never,
        },
      };
    case "run.interrupted":
      return {
        id: frameId,
        type: "run.interrupted",
        sent_at: sentAt,
        ...replayedFlag,
        event: {
          ...base,
          sdk_type: "status",
          kind: "run.interrupted",
          payload: row.payload as never,
        },
      };
    default:
      // Unknown kind — drop on the floor (the DB still has the row
      // for inspection) but call out the drift. If you see this log
      // and `row.kind` is a known CanonicalEventKind, the switch
      // above is missing a case. If it's truly unknown, the
      // normalizer wrote a kind that isn't in the shared schema.
      assertKindIsKnown(row.kind);
      return null;
  }
}

/**
 * Compile-time + runtime check that every `kind` we ever emit has a
 * corresponding frame-builder case. The KNOWN_KINDS const is typed
 * as `Record<CanonicalEventKind, true>` so TypeScript fails the
 * typecheck if a new CanonicalEventKind is added without an entry
 * here — which is the prompt to add a `case` to the switch above.
 *
 * The runtime branch logs a warning when an unexpected `kind` (e.g.
 * from a corrupted DB row or a forgotten normalizer addition) reaches
 * the frame-builder, so the drift surfaces operationally instead of
 * silently returning null.
 */
const KNOWN_KINDS: Record<CanonicalEventKind, true> = {
  "system.init": true,
  "system.unknown_sdk_message": true, // intentionally non-broadcast
  "user.message": true,
  "assistant.delta": true,
  "assistant.snapshot": true,
  "thinking.delta": true,
  "thinking.snapshot": true,
  "tool_call.running": true,
  "tool_call.completed": true,
  "tool_call.error": true,
  "status.changed": true,
  "task.updated": true,
  "request.created": true,
  "code_edit.detected": true,
  "run.final_result": true,
  "run.interrupted": true,
};

function assertKindIsKnown(kind: string): void {
  if (!(kind in KNOWN_KINDS)) {
    console.warn(
      `[frame-builder] unknown canonical event kind "${kind}" — frame dropped. ` +
        `If this is a new kind, add it to the switch in buildServerFrame.`,
    );
  } else if (!NON_BROADCAST_EVENT_KINDS.has(kind as CanonicalEventKind)) {
    // The kind is registered as broadcastable but the switch above
    // didn't match it — caller forgot to add a case.
    console.warn(
      `[frame-builder] broadcastable kind "${kind}" reached the default branch — ` +
        `missing case in buildServerFrame switch?`,
    );
  }
}

interface ToolCallPayloadShape {
  call_id: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  truncated?: { args?: boolean; result?: boolean };
  large_payload_refs?: {
    args_event_url?: string;
    result_event_url?: string;
    raw_event_url?: string;
  };
  timing?: { started_at?: string; completed_at?: string; duration_ms?: number };
}

function buildToolCallPayload(row: EventRow): ToolCallPayloadShape {
  const original = row.payload as ToolCallPayloadShape;
  // The byte count check uses the stored payload size — set by the events
  // repo at insert time. If the payload exceeds the threshold, swap `args`
  // and `result` for references and let `JsonInspector` fetch them lazily.
  if (row.payloadBytes <= LARGE_PAYLOAD_THRESHOLD_BYTES) {
    return original;
  }
  // Build a slim projection: keep timing/truncated/status/call_id/name but
  // strip the heavy args+result and surface the REST URLs instead.
  const slim: ToolCallPayloadShape = {
    call_id: original.call_id,
    name: original.name,
    status: original.status,
    ...(original.truncated !== undefined ? { truncated: original.truncated } : {}),
    ...(original.timing !== undefined ? { timing: original.timing } : {}),
    large_payload_refs: buildLargePayloadRefs(row),
  };
  return slim;
}

function buildLargePayloadRefs(row: EventRow): {
  args_event_url?: string;
  result_event_url?: string;
  raw_event_url?: string;
} {
  // Spec §4 "REST Endpoints → Events" exposes
  // `/api/events/:eventId/large-payload/:field`. The field
  // discriminator tells the route which JSON sub-tree to slice out.
  // URL template lives in buildLargePayloadUrl above so Phase 10's
  // route definition can share the exact format.
  const refs: {
    args_event_url?: string;
    result_event_url?: string;
    raw_event_url?: string;
  } = {};
  const payload = row.payload as { args?: unknown; result?: unknown };
  if (payload.args !== undefined) {
    refs.args_event_url = buildLargePayloadUrl(row.id, "args");
  }
  if (payload.result !== undefined) {
    refs.result_event_url = buildLargePayloadUrl(row.id, "result");
  }
  if (row.raw !== null) {
    refs.raw_event_url = buildLargePayloadUrl(row.id, "raw");
  }
  return refs;
}
