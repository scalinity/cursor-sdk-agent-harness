export type StreamingTextUpdate = {
  text: string;
  isReplacement: boolean;
};

type Listener = (update: StreamingTextUpdate) => void;

const listenersById = new Map<string, Set<Listener>>();
// F-006: cache the most-recent update per streamId so subscribers that
// register AFTER a publish still see the latest text. Without this, the
// initial useStreamingMarkdown publish that fires synchronously during
// applyText() is dropped on the floor because the matching StreamingText
// component hasn't mounted yet — the user sees only "STREAM" instead of
// "STREAMING WORKS" on the first paint of a freshly-replayed run.
const latestUpdateById = new Map<string, StreamingTextUpdate>();
// Hard cap to bound memory across long sessions with many runs. Map
// preserves insertion order, so the oldest entry is the first key.
// 2000 ≈ many hours of agent activity (each paragraph/list-item is one
// entry); chosen as much-larger-than-any-realistic-active-run-set but
// small enough to keep memory bounded.
const LATEST_UPDATE_CAP = 2000;

export function publishStreamingText(streamId: string, update: StreamingTextUpdate): void {
  // Re-insert to refresh insertion order so frequently-published streams
  // stay alive under the FIFO eviction below.
  if (latestUpdateById.has(streamId)) latestUpdateById.delete(streamId);
  latestUpdateById.set(streamId, update);
  while (latestUpdateById.size > LATEST_UPDATE_CAP) {
    const oldest = latestUpdateById.keys().next().value;
    if (oldest === undefined) break;
    latestUpdateById.delete(oldest);
  }
  const listeners = listenersById.get(streamId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(update);
  }
}

export function subscribeStreamingText(streamId: string, listener: Listener): () => void {
  const existing = listenersById.get(streamId);
  const listeners = existing ?? new Set<Listener>();
  listeners.add(listener);
  if (!existing) listenersById.set(streamId, listeners);
  const buffered = latestUpdateById.get(streamId);
  if (buffered !== undefined) {
    // Replay the most recent update so a late subscriber catches up.
    listener(buffered);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersById.delete(streamId);
      // NB: deliberately NOT deleting latestUpdateById here. React
      // StrictMode runs every effect's cleanup before re-running the
      // effect in dev — if we dropped the buffer on size===0, the
      // re-subscribe would see nothing and the user gets only "STREAM"
      // instead of "STREAMING WORKS". The buffer is bounded by
      // LATEST_UPDATE_CAP above.
    }
  };
}

// Test-only: reset module-scoped state between vitest runs. Calling
// this from production code is a no-op safety hazard — it would drop
// active subscriber listeners. Gate by environment if you must.
export function __resetForTests(): void {
  listenersById.clear();
  latestUpdateById.clear();
}