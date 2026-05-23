export type StreamingTextUpdate = {
  text: string;
  isReplacement: boolean;
};

type Listener = (update: StreamingTextUpdate) => void;

const listenersById = new Map<string, Set<Listener>>();

export function publishStreamingText(streamId: string, update: StreamingTextUpdate): void {
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
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersById.delete(streamId);
  };
}