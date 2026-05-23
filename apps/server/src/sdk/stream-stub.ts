import type { FastifyBaseLogger } from "fastify";

/**
 * Phase 06 stub for the per-event sink. Phase 07 replaces this with the
 * normalization → persist → broadcast pipeline. Until then, sinks just log
 * a redacted projection of the event so the runtime end-to-end path is
 * exercised by integration tests.
 *
 * Keep the signature stable — the eventual normalizer must drop in here
 * without rippling through `RunController` / `AgentRuntime`.
 */
export type StreamSink = (event: unknown) => Promise<void> | void;

export function createStubSink(logger: FastifyBaseLogger): StreamSink {
  return (event) => {
    const summary = summariseEvent(event);
    logger.debug({ sdkEvent: summary }, "sdk.event (phase06 stub)");
  };
}

// TODO(Phase 07): the Phase 07 normalizer will canonicalize SDK event
// shapes into camelCase canonical events. Once that lands, drop the
// dual-casing (snake `agent_id` AND camel `agentId`) reads below — the
// summariser will see canonical events only.
function summariseEvent(event: unknown): {
  type: string;
  agentId?: string;
  runId?: string;
  callId?: string;
  requestId?: string;
  status?: string;
  toolName?: string;
} {
  if (event === null || typeof event !== "object") {
    return { type: "<non-object>" };
  }
  const rec = event as Record<string, unknown>;
  return {
    type: typeof rec.type === "string" ? rec.type : "<unknown>",
    ...pickString(rec, "agent_id", "agentId"),
    ...pickString(rec, "run_id", "runId"),
    ...pickString(rec, "call_id", "callId"),
    ...pickString(rec, "request_id", "requestId"),
    ...pickString(rec, "status", "status"),
    ...pickString(rec, "name", "toolName"),
  };
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
  outKey: string,
): Record<string, string> {
  const v = obj[key];
  if (typeof v === "string") return { [outKey]: v };
  return {};
}
