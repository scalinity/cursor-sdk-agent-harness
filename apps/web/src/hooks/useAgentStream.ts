/**
 * useAgentStream — coordinates the WebSocket with `run-store`.
 *
 * Responsibilities:
 *   - Opens the WS connection (via `useWebSocket`).
 *   - On open AND when `activeRunId` changes, sends `subscribe_run` with
 *     `after_seq = run-store.eventsByRunId[runId].lastSeq`.
 *   - On unmount / runId change, sends `unsubscribe_run` — but only if
 *     the socket is currently open (RV2-W7).
 *   - On reconnect (`connectionState` flips back to "open"), every
 *     previously-subscribed run is re-subscribed with its current
 *     `lastSeq` so callers that used the exposed `subscribeRun` API
 *     don't need to re-fire after reconnect (RV2-W8).
 *   - Forwards every frame to `run-store.ingestServerFrame`.
 *   - Exposes `submitUserInput` (REST POST /api/runs) and `cancelRun`.
 *
 * The hook treats WS as event delivery only. Run creation goes through REST
 * because the server needs to mint the runId and persist the row before any
 * stream begins.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRunResponseSchema,
  type ClientFrame,
  type ServerFrame,
} from "@harness/shared";
import { useRunStore } from "../state/run-store.js";
import { useUiStore, type ConnectionState } from "../state/ui-store.js";
import { useWebSocket } from "./useWebSocket.js";
import { useMutatingRequest } from "./useMutatingRequest.js";
import { wsUrl } from "../lib/api-base.js";
import type { ContextMention, SdkImage } from "@harness/shared";

// Absolute `ws(s)://…/ws` in the packaged desktop app (renderer is on
// app://harness and must reach the embedded server cross-origin); plain
// "/ws" in browser/dev, resolved against window.location by useWebSocket.
const WS_URL = wsUrl("/ws");
const MAX_SUBSCRIBE_RETRIES = 3;

export interface UseAgentStreamInput {
  agentId: string | null;
  runId?: string | null;
}

export interface UseAgentStreamResult {
  connectionState: ConnectionState;
  activeRunId: string | null;
  submitUserInput: (
    input: { prompt: string; agentId: string; images?: SdkImage[]; mentions?: ContextMention[] },
  ) => Promise<string>;
  cancelRun: (runId: string) => void;
  subscribeRun: (runId: string) => void;
  unsubscribeRun: (runId: string) => void;
  /**
   * Phase 13 — send an `approval_response` WS frame. The server resolves
   * the approval through `ApprovalResponder.resolve`; the resulting
   * `approval.resolved` or `approval.failed` event flows back through
   * `ingestServerFrame` so the inline ApprovalPrompt updates without
   * any extra plumbing.
   */
  sendApproval: (
    runId: string,
    requestId: string,
    decision: "approve" | "deny",
    reason?: string,
  ) => void;
  /**
   * Phase 13 — the last `CANCEL_UNAVAILABLE` error frame seen for the
   * active run, or null when no such error is current. Set by the WS
   * onFrame handler when the server replies that cancel cannot resolve;
   * cleared when the run terminates or a new run becomes active.
   */
  cancelUnavailable: { message: string } | null;
}

function makeFrameId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildSubscribeFrame(runId: string): ClientFrame {
  const lastSeq = useRunStore.getState().eventsByRunId[runId]?.lastSeq ?? 0;
  return {
    id: makeFrameId("sub"),
    type: "subscribe_run",
    sent_at: new Date().toISOString(),
    run_id: runId,
    after_seq: lastSeq,
    replay: { enabled: true, speed: "instant" },
  };
}

export function useAgentStream(input: UseAgentStreamInput): UseAgentStreamResult {
  const mutate = useMutatingRequest();
  const csrfToken = useUiStore((s) => s.csrfToken);
  const setConnectionState = useUiStore((s) => s.setConnectionState);
  const ingestServerFrame = useRunStore((s) => s.ingestServerFrame);
  const setActiveRunId = useRunStore((s) => s.setActiveRunId);
  const activeRunId = useRunStore((s) => s.activeRunId);

  // Track subscribed runIds so the reconnect-resume effect can replay
  // every prior subscription. The set survives socket churn within this
  // hook lifetime; cleared on unmount.
  const subscribedRef = useRef<Set<string>>(new Set());
  const subscribeFrameRunIdsRef = useRef<Map<string, string>>(new Map());
  const subscribeRetryCountRef = useRef<Map<string, number>>(new Map());
  const sendRef = useRef<(frame: ClientFrame) => void>(() => undefined);

  const [cancelUnavailable, setCancelUnavailable] = useState<
    { message: string } | null
  >(null);
  // RV2-W9: track the last cancel frame id we sent for the active
  // run so we can correlate CANCEL_UNAVAILABLE error frames back to
  // it. Without this, a late-arriving error for a superseded run
  // would still raise the banner.
  const lastCancelFrameIdRef = useRef<string | null>(null);

  const sendSubscribe = useCallback((runId: string) => {
    const frame = buildSubscribeFrame(runId);
    subscribeFrameRunIdsRef.current.set(frame.id, runId);
    subscribedRef.current.add(runId);
    sendRef.current(frame);
  }, []);

  const onFrame = useCallback(
    (frame: ServerFrame) => {
      if (frame.type === "ack" && frame.ack_for) {
        const runId = subscribeFrameRunIdsRef.current.get(frame.ack_for);
        if (runId) {
          subscribeFrameRunIdsRef.current.delete(frame.ack_for);
          subscribeRetryCountRef.current.delete(runId);
        }
      }
      if (frame.type === "error" && frame.retryable && frame.ack_for) {
        const runId = subscribeFrameRunIdsRef.current.get(frame.ack_for);
        if (runId) {
          subscribeFrameRunIdsRef.current.delete(frame.ack_for);
          if (!subscribedRef.current.has(runId)) return;
          const attempts = subscribeRetryCountRef.current.get(runId) ?? 0;
          if (attempts >= MAX_SUBSCRIBE_RETRIES) {
            console.warn("[useAgentStream] retryable subscribe failed repeatedly", {
              runId,
              attempts,
              message: frame.message,
            });
            return;
          }
          subscribeRetryCountRef.current.set(runId, attempts + 1);
          queueMicrotask(() => sendSubscribe(runId));
          return;
        }
      }
      if (frame.type === "error" && frame.code === "CANCEL_UNAVAILABLE") {
        // RV2-W9: only set the banner when the error correlates to
        // the cancel frame we just issued. The server stamps
        // `ack_for` on every error frame for client cancel; if the
        // error is for a stale or unrelated cancel, ignore it.
        if (
          frame.ack_for &&
          lastCancelFrameIdRef.current === frame.ack_for
        ) {
          setCancelUnavailable({ message: frame.message });
        }
        return;
      }
      ingestServerFrame(frame);
    },
    [ingestServerFrame, sendSubscribe],
  );

  const { send, connectionState } = useWebSocket({
    url: WS_URL,
    csrfToken,
    onFrame,
    onStateChange: setConnectionState,
  });
  sendRef.current = send;

  // Subscribe to the target runId whenever it changes AND we're connected.
  // The seq cursor is read at send time so we never subscribe with a stale 0.
  const targetRunId = input.runId ?? activeRunId ?? null;
  useEffect(() => {
    if (connectionState !== "open") return;
    if (!targetRunId) return;

    const subscribed = subscribedRef.current;
    const retryCounts = subscribeRetryCountRef.current;
    sendSubscribe(targetRunId);

    return () => {
      // Only send unsubscribe when the socket is OPEN — otherwise the
      // frame would land in the outbound queue and replay on reconnect
      // against a run the user has since moved away from. The server
      // tolerates unsubscribe-of-not-subscribed, so dropping on closed
      // sockets is safe.
      if (useUiStore.getState().connectionState === "open") {
        send({
          id: makeFrameId("unsub"),
          type: "unsubscribe_run",
          sent_at: new Date().toISOString(),
          run_id: targetRunId,
        });
      }
      subscribed.delete(targetRunId);
      retryCounts.delete(targetRunId);
    };
  }, [connectionState, targetRunId, send, sendSubscribe]);

  // Reconnect-resume: when connectionState flips back to "open", any
  // run that was subscribed via the exposed `subscribeRun(runId)` API
  // (i.e. NOT the single targetRunId driven by the effect above) gets
  // a fresh subscribe with the current lastSeq. Without this, callers
  // that subscribed independently would be silently dropped after
  // reconnect.
  useEffect(() => {
    if (connectionState !== "open") return;
    const subscribed = subscribedRef.current;
    for (const runId of subscribed) {
      if (runId === targetRunId) continue; // already handled by the effect above.
      sendSubscribe(runId);
    }
  }, [connectionState, targetRunId, sendSubscribe]);

  // Clear the subscribed set on unmount so a future remount starts fresh.
  useEffect(() => {
    const subscribed = subscribedRef.current;
    return () => {
      subscribed.clear();
    };
  }, []);

  const submitUserInput = useCallback(
    async ({
      prompt,
      agentId,
      images,
      mentions,
    }: {
      prompt: string;
      agentId: string;
      images?: SdkImage[];
      mentions?: ContextMention[];
    }): Promise<string> => {
      const res = await mutate("/api/runs", {
        method: "POST",
        body: {
          agentId,
          prompt,
          ...(images && images.length > 0 ? { images } : {}),
          ...(mentions && mentions.length > 0 ? { mentions } : {}),
        },
        responseSchema: createRunResponseSchema,
      });
      setActiveRunId(res.runId);
      return res.runId;
    },
    [mutate, setActiveRunId],
  );

  const cancelRun = useCallback(
    (runId: string) => {
      const frameId = makeFrameId("cancel");
      // RV2-W9: remember the most recent cancel frame id so the
      // onFrame handler can correlate the CANCEL_UNAVAILABLE error
      // against THIS cancel (and ignore late-arriving errors for
      // superseded cancels).
      lastCancelFrameIdRef.current = frameId;
      // Clear any banner from a previous cancel so the new attempt
      // starts with a clean slate.
      setCancelUnavailable(null);
      send({
        id: frameId,
        type: "cancel_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
      });
    },
    [send],
  );

  const subscribeRun = useCallback(
    (runId: string) => {
      sendSubscribe(runId);
    },
    [sendSubscribe],
  );

  const unsubscribeRun = useCallback(
    (runId: string) => {
      send({
        id: makeFrameId("unsub"),
        type: "unsubscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
      });
      subscribedRef.current.delete(runId);
      subscribeRetryCountRef.current.delete(runId);
    },
    [send],
  );

  const sendApproval = useCallback(
    (
      runId: string,
      requestId: string,
      decision: "approve" | "deny",
      reason?: string,
    ) => {
      send({
        id: makeFrameId("approval"),
        type: "approval_response",
        sent_at: new Date().toISOString(),
        run_id: runId,
        request_id: requestId,
        decision,
        ...(reason !== undefined ? { reason } : {}),
      });
    },
    [send],
  );

  // Clear the CANCEL_UNAVAILABLE banner when the active run changes so
  // a banner from a prior run doesn't follow the user into a new one.
  useEffect(() => {
    setCancelUnavailable(null);
    lastCancelFrameIdRef.current = null;
  }, [targetRunId]);

  // RV2-W9: also clear the banner when the active run transitions
  // to a terminal status. A stale banner for a finished run is
  // visually confusing — if the run is done, "cancel unavailable"
  // is no longer actionable.
  const activeRunStatus = useRunStore((s) =>
    targetRunId ? (s.byId[targetRunId]?.status ?? null) : null,
  );
  useEffect(() => {
    if (
      activeRunStatus === "FINISHED" ||
      activeRunStatus === "ERROR" ||
      activeRunStatus === "CANCELLED" ||
      activeRunStatus === "EXPIRED"
    ) {
      setCancelUnavailable(null);
    }
  }, [activeRunStatus]);

  // Mark agentId as referenced even though we don't use it directly — the
  // caller passes it for future filtering (Phase 09 may scope to agent).
  void input.agentId;

  return {
    connectionState,
    activeRunId: targetRunId,
    submitUserInput,
    cancelRun,
    subscribeRun,
    unsubscribeRun,
    sendApproval,
    cancelUnavailable,
  };
}
