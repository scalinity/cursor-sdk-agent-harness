import type { EventRow } from "@harness/shared";

/**
 * In-memory pub/sub keyed by `run_id`. The persist-and-broadcast pipeline
 * publishes events here AFTER the DB commit succeeds; WS subscribers receive
 * them and forward as `sdk.*` frames.
 *
 * The bus does not buffer or replay — historical events live in SQLite and
 * are sent through `replay-sender` on subscribe. The bus only carries the
 * live tail.
 */
export type RunBusListener = (event: EventRow) => void;

export interface RunBus {
  subscribe(runId: string, listener: RunBusListener): () => void;
  publish(runId: string, event: EventRow): void;
  hasSubscribers(runId: string): boolean;
  /** Total number of currently-subscribed listeners across all runs. */
  size(): number;
  /** Clear all subscriptions. Tests use this in `afterEach`. */
  clear(): void;
}

export function createRunBus(): RunBus {
  const byRunId = new Map<string, Set<RunBusListener>>();

  return {
    subscribe(runId, listener) {
      let set = byRunId.get(runId);
      if (!set) {
        set = new Set();
        byRunId.set(runId, set);
      }
      set.add(listener);
      return () => {
        const s = byRunId.get(runId);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) byRunId.delete(runId);
      };
    },

    publish(runId, event) {
      const set = byRunId.get(runId);
      if (!set || set.size === 0) return;
      // Snapshot the listener set BEFORE iterating so a listener that
      // unsubscribes itself (e.g. an error-handling close path) can't mutate
      // the set mid-iteration.
      const snapshot = Array.from(set);
      // Defer the fanout to setImmediate so the persist-and-broadcast
      // caller returns control to the event loop after the DB commit
      // instead of running listeners synchronously on the commit path.
      //
      // IMPORTANT: each listener still runs SYNCHRONOUSLY inside the
      // for-loop below. A listener that writes to a slow socket
      // (TCP send-buffer backpressure) WILL head-of-line block every
      // subsequent listener on the same tick. Single-user/local this
      // is fine; if a future phase adds multiple subscribers per run
      // (replay viewer + live viewer), give each subscription its own
      // per-listener queue + drain loop to break the HoL coupling.
      setImmediate(() => {
        for (const listener of snapshot) {
          try {
            listener(event);
          } catch {
            // Listeners are responsible for their own error handling; the bus
            // never propagates listener errors back to the publisher.
          }
        }
      });
    },

    hasSubscribers(runId) {
      const set = byRunId.get(runId);
      return set !== undefined && set.size > 0;
    },

    size() {
      let total = 0;
      for (const set of byRunId.values()) total += set.size;
      return total;
    },

    clear() {
      byRunId.clear();
    },
  };
}
