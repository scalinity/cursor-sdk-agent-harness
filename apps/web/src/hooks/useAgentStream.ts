/**
 * useAgentStream — coordinates the WebSocket with `run-store`.
 *
 * Responsibilities:
 *   - Opens the WS connection (via `useWebSocket`).
 *   - On open AND when `activeRunId` changes, sends `subscribe_run` with
 *     `after_seq = run-store.eventsByRunId[runId].lastSeq`.
 *   - On unmount / runId change, sends `unsubscribe_run`.
 *   - Forwards every frame to `run-store.ingestServerFrame`.
 *   - Exposes `submitUserInput` (REST POST /api/runs) and `cancelRun`.
 *
 * The hook treats WS as event delivery only. Run creation goes through REST
 * because the server needs to mint the runId and persist the row before any
 * stream begins.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  createRunResponseSchema,
  type ClientFrame,
  type ServerFrame,
} from "@harness/shared";
import { mutatingRequest } from "../lib/http-client.js";
import { useRunStore } from "../state/run-store.js";
import { useUiStore, type ConnectionState } from "../state/ui-store.js";
import { useWebSocket } from "./useWebSocket.js";
import { useCsrfToken } from "./useCsrfToken.js";

const WS_URL = "/ws";

export interface UseAgentStreamInput {
  agentId: string | null;
  runId?: string | null;
}

export interface UseAgentStreamResult {
  connectionState: ConnectionState;
  activeRunId: string | null;
  submitUserInput: (input: { prompt: string; agentId: string }) => Promise<string>;
  cancelRun: (runId: string) => void;
  subscribeRun: (runId: string) => void;
  unsubscribeRun: (runId: string) => void;
}

function makeFrameId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useAgentStream(input: UseAgentStreamInput): UseAgentStreamResult {
  const { refresh: refreshCsrfToken } = useCsrfToken();
  const csrfToken = useUiStore((s) => s.csrfToken);
  const setConnectionState = useUiStore((s) => s.setConnectionState);
  const ingestServerFrame = useRunStore((s) => s.ingestServerFrame);
  const setActiveRunId = useRunStore((s) => s.setActiveRunId);
  const activeRunId = useRunStore((s) => s.activeRunId);

  // Track subscribed runIds so we can resume after reconnect.
  const subscribedRef = useRef<Set<string>>(new Set());

  const onFrame = useCallback(
    (frame: ServerFrame) => {
      // Mark replayed events so the renderer can suppress live-only animations.
      const replayed = frame.type !== "ack" && frame.type !== "heartbeat" && frame.type !== "error";
      if (replayed) {
        // `replayed: true` lives on the frame implicitly via the server (the
        // bus tags via the frame's event metadata in Phase 09). For now we
        // always treat ingest as live; the store still dedupes by seq.
      }
      ingestServerFrame(frame);
    },
    [ingestServerFrame],
  );

  const { send, connectionState } = useWebSocket({
    url: WS_URL,
    csrfToken,
    onFrame,
    onStateChange: setConnectionState,
  });

  // Subscribe to the current runId whenever it changes AND we're connected.
  // The seq cursor is read at send time so we don't subscribe with a stale 0.
  const targetRunId = input.runId ?? activeRunId ?? null;
  useEffect(() => {
    if (connectionState !== "open") return;
    if (!targetRunId) return;

    const lastSeq = useRunStore.getState().eventsByRunId[targetRunId]?.lastSeq ?? 0;
    const frame: ClientFrame = {
      id: makeFrameId("sub"),
      type: "subscribe_run",
      sent_at: new Date().toISOString(),
      run_id: targetRunId,
      after_seq: lastSeq,
      replay: { enabled: true, speed: "instant" },
    };
    const subscribed = subscribedRef.current;
    subscribed.add(targetRunId);
    send(frame);

    return () => {
      // Best-effort unsubscribe; the server tolerates unsubscribe-of-not-subscribed.
      send({
        id: makeFrameId("unsub"),
        type: "unsubscribe_run",
        sent_at: new Date().toISOString(),
        run_id: targetRunId,
      });
      subscribed.delete(targetRunId);
    };
  }, [connectionState, targetRunId, send]);

  const submitUserInput = useCallback(
    async ({ prompt, agentId }: { prompt: string; agentId: string }): Promise<string> => {
      const res = await mutatingRequest("/api/runs", {
        method: "POST",
        body: { agentId, prompt },
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken,
        responseSchema: createRunResponseSchema,
      });
      setActiveRunId(res.runId);
      return res.runId;
    },
    [refreshCsrfToken, setActiveRunId],
  );

  const cancelRun = useCallback(
    (runId: string) => {
      send({
        id: makeFrameId("cancel"),
        type: "cancel_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
      });
    },
    [send],
  );

  const subscribeRun = useCallback(
    (runId: string) => {
      const lastSeq = useRunStore.getState().eventsByRunId[runId]?.lastSeq ?? 0;
      send({
        id: makeFrameId("sub"),
        type: "subscribe_run",
        sent_at: new Date().toISOString(),
        run_id: runId,
        after_seq: lastSeq,
        replay: { enabled: true, speed: "instant" },
      });
      subscribedRef.current.add(runId);
    },
    [send],
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
    },
    [send],
  );

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
  };
}
