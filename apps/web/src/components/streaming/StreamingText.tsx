import { useStreamingTextNode } from "../../hooks/useStreamingTextNode.js";

export interface StreamingTextProps {
  text: string;
  isReplacement?: boolean;
  streamId?: string;
}

export function StreamingText({ text, isReplacement, streamId }: StreamingTextProps) {
  const ref = useStreamingTextNode({
    text,
    isReplacement: isReplacement ?? false,
    streamId,
  });
  return <span ref={ref} className="streaming-text" />;
}
