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

export function publishStreamingText(streamId: string, update: StreamingTextUpdate): void {
  latestUpdateById.set(streamId, update);
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
      // instead of "STREAMING WORKS". The buffer is overwritten on the
      // next publish for the same streamId; in the worst case (a run is
      // navigated away from for good) the entry holds one short string
      // until the next publish or process restart.
    }
  };
}