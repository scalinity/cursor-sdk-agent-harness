import { useCallback, useEffect, useRef, type RefCallback } from "react";
import { subscribeStreamingText } from "../lib/streaming-text-channel.js";

export interface UseStreamingTextNodeInput {
  text: string;
  isReplacement: boolean;
  streamId?: string | undefined;
}

type PendingUpdate = {
  text: string;
  isReplacement: boolean;
};

function getRequestAnimationFrame(): typeof requestAnimationFrame {
  return globalThis.requestAnimationFrame ?? ((cb) => window.setTimeout(() => cb(performance.now()), 16));
}

function getCancelAnimationFrame(): typeof cancelAnimationFrame {
  return globalThis.cancelAnimationFrame ?? ((id) => window.clearTimeout(id));
}

export function useStreamingTextNode(input: UseStreamingTextNodeInput): RefCallback<HTMLSpanElement> {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const textNodeRef = useRef<Text | null>(null);
  const lastSeenTextRef = useRef("");
  const pendingRef = useRef<PendingUpdate | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestInputRef = useRef(input);
  latestInputRef.current = input;

  const flush = useCallback(() => {
    rafRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    const element = elementRef.current;
    if (!pending || !element) return;

    let textNode = textNodeRef.current;
    if (!textNode || textNode.parentNode !== element) {
      textNode = document.createTextNode("");
      element.textContent = "";
      element.appendChild(textNode);
      textNodeRef.current = textNode;
      lastSeenTextRef.current = "";
    }

    const previous = lastSeenTextRef.current;
    const shouldReplace = pending.isReplacement || !pending.text.startsWith(previous);
    if (shouldReplace) {
      textNode.nodeValue = pending.text;
    } else if (pending.text.length > previous.length) {
      textNode.nodeValue = `${textNode.nodeValue ?? ""}${pending.text.slice(previous.length)}`;
    }
    lastSeenTextRef.current = pending.text;
  }, []);

  const schedule = useCallback(
    (update: PendingUpdate) => {
      pendingRef.current = update;
      if (rafRef.current !== null) return;
      rafRef.current = getRequestAnimationFrame()(flush);
    },
    [flush],
  );

  const ref = useCallback<RefCallback<HTMLSpanElement>>(
    (node) => {
      elementRef.current = node;
      if (!node) {
        textNodeRef.current = null;
        lastSeenTextRef.current = "";
        return;
      }
      if (!textNodeRef.current || textNodeRef.current.parentNode !== node) {
        const textNode = document.createTextNode("");
        node.textContent = "";
        node.appendChild(textNode);
        textNodeRef.current = textNode;
      }
      schedule({ text: latestInputRef.current.text, isReplacement: true });
    },
    [schedule],
  );

  useEffect(() => {
    schedule({ text: input.text, isReplacement: input.isReplacement });
  }, [input.isReplacement, input.text, schedule]);

  useEffect(() => {
    if (!input.streamId) return undefined;
    return subscribeStreamingText(input.streamId, schedule);
  }, [input.streamId, schedule]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        getCancelAnimationFrame()(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return ref;
}
