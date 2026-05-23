import { z } from "zod";
import type { CanonicalRunEvent } from "../state/run-store.js";

const largePayloadRefsSchema = z.object({
  args_event_url: z.string().optional(),
  result_event_url: z.string().optional(),
  raw_event_url: z.string().optional(),
});

const toolPayloadSchema = z.object({
  call_id: z.string(),
  name: z.string(),
  status: z.enum(["running", "completed", "error"]),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  truncated: z.object({ args: z.boolean().optional(), result: z.boolean().optional() }).optional(),
  large_payload_refs: largePayloadRefsSchema.optional(),
  timing: z
    .object({
      started_at: z.string().optional(),
      completed_at: z.string().optional(),
      duration_ms: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export interface LargePayloadRefs {
  argsEventUrl?: string | undefined;
  resultEventUrl?: string | undefined;
  rawEventUrl?: string | undefined;
}

export interface ToolCallProjection {
  callId: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  startedAtSeq: number;
  completedAtSeq?: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number | undefined;
  truncated?: {
    args?: boolean | undefined;
    result?: boolean | undefined;
  };
  largePayloadRefs?: LargePayloadRefs;
  errorMessage?: string;
}

export type ToolCallLaneGroup =
  | { type: "card"; callId: string }
  | { type: "lane"; callIds: string[] };

function durationFromDates(startedAt: string, completedAt: string): number | undefined {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return undefined;
  return Math.max(0, completed - started);
}

function normalizeLargePayloadRefs(
  refs: z.infer<typeof largePayloadRefsSchema> | undefined,
): LargePayloadRefs | undefined {
  if (!refs) return undefined;
  const normalized: LargePayloadRefs = {};
  if (refs.args_event_url !== undefined) normalized.argsEventUrl = refs.args_event_url;
  if (refs.result_event_url !== undefined) normalized.resultEventUrl = refs.result_event_url;
  if (refs.raw_event_url !== undefined) normalized.rawEventUrl = refs.raw_event_url;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function projectionFromEvent(event: CanonicalRunEvent, payload: z.infer<typeof toolPayloadSchema>): ToolCallProjection {
  const base: ToolCallProjection = {
    callId: payload.call_id,
    name: payload.name,
    status: payload.status,
    startedAtSeq: event.seq,
    startedAt: payload.timing?.started_at ?? event.occurred_at,
  };
  if (payload.args !== undefined) base.args = payload.args;
  if (payload.result !== undefined) base.result = payload.result;
  if (payload.truncated !== undefined) base.truncated = payload.truncated;
  const largePayloadRefs = normalizeLargePayloadRefs(payload.large_payload_refs);
  if (largePayloadRefs !== undefined) base.largePayloadRefs = largePayloadRefs;
  if (payload.status !== "running") {
    base.completedAtSeq = event.seq;
    base.completedAt = payload.timing?.completed_at ?? event.occurred_at;
    base.durationMs =
      payload.timing?.duration_ms ?? durationFromDates(base.startedAt, base.completedAt);
  }
  if (payload.status === "error") {
    base.errorMessage = typeof payload.result === "string" ? payload.result : "Tool call failed.";
  }
  return base;
}

export function deriveToolCallProjections(events: readonly CanonicalRunEvent[]): ToolCallProjection[] {
  const byCallId = new Map<string, ToolCallProjection>();
  const order: string[] = [];

  for (const event of events) {
    if (event.sdk_type !== "tool_call") continue;
    if (!event.kind.startsWith("tool_call.")) continue;
    const parsed = toolPayloadSchema.safeParse(event.payload);
    if (!parsed.success) continue;
    const payload = parsed.data;
    const existing = byCallId.get(payload.call_id);
    if (!existing) {
      byCallId.set(payload.call_id, projectionFromEvent(event, payload));
      order.push(payload.call_id);
      continue;
    }

    existing.status = payload.status;
    existing.name = payload.name || existing.name;
    if (payload.args !== undefined) existing.args = payload.args;
    if (payload.result !== undefined) existing.result = payload.result;
    if (payload.truncated !== undefined) existing.truncated = payload.truncated;
    const largePayloadRefs = normalizeLargePayloadRefs(payload.large_payload_refs);
    if (largePayloadRefs !== undefined) existing.largePayloadRefs = largePayloadRefs;
    if (payload.status !== "running") {
      existing.completedAtSeq = event.seq;
      existing.completedAt = payload.timing?.completed_at ?? event.occurred_at;
      existing.durationMs =
        payload.timing?.duration_ms ?? durationFromDates(existing.startedAt, existing.completedAt);
    }
    if (payload.status === "error") {
      existing.errorMessage = typeof payload.result === "string" ? payload.result : "Tool call failed.";
    }
  }

  return order.map((callId) => byCallId.get(callId)).filter((p): p is ToolCallProjection => p !== undefined);
}

function overlaps(a: ToolCallProjection, b: ToolCallProjection): boolean {
  const aEnd = a.completedAtSeq ?? Number.POSITIVE_INFINITY;
  const bEnd = b.completedAtSeq ?? Number.POSITIVE_INFINITY;
  return a.startedAtSeq < bEnd && b.startedAtSeq < aEnd;
}

export function groupToolCallLanes(projections: readonly ToolCallProjection[]): ToolCallLaneGroup[] {
  const groups: ToolCallLaneGroup[] = [];
  const consumed = new Set<string>();

  for (let i = 0; i < projections.length; i += 1) {
    const current = projections[i]!;
    if (consumed.has(current.callId)) continue;
    if (current.status !== "running") {
      groups.push({ type: "card", callId: current.callId });
      consumed.add(current.callId);
      continue;
    }

    const lane = [current.callId];
    consumed.add(current.callId);
    for (let j = i + 1; j < projections.length; j += 1) {
      const next = projections[j]!;
      if (consumed.has(next.callId) || next.status !== "running") continue;
      if (overlaps(current, next)) {
        lane.push(next.callId);
        consumed.add(next.callId);
      }
    }
    groups.push(lane.length > 1 ? { type: "lane", callIds: lane } : { type: "card", callId: current.callId });
  }

  return groups;
}
