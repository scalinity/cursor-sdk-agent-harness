import { SDK_RUN_TERMINAL_STATUSES } from "@harness/shared";
import { useStreamingMarkdown } from "../../hooks/useStreamingMarkdown.js";
import { useRunStore } from "../../state/run-store.js";
import { MarkdownBlockView } from "./MarkdownBlockView.js";

export interface StreamingMarkdownProps {
  runId: string;
  source: "assistant" | "thinking";
}

export function StreamingMarkdown({ runId, source }: StreamingMarkdownProps) {
  const { blocks, fallbackText } = useStreamingMarkdown({ runId, source });
  const status = useRunStore((s) => s.byId[runId]?.status ?? null);
  const terminal = status !== null && SDK_RUN_TERMINAL_STATUSES.has(status);
  const streamIdPrefix = `${runId}:${source}`;

  if (fallbackText !== null) {
    return <pre className="streaming-md streaming-md--fallback mono">{fallbackText}</pre>;
  }

  return (
    <div className="streaming-md" data-source={source}>
      {blocks.map((block) => (
        <MarkdownBlockView key={block.id} block={block} streamIdPrefix={streamIdPrefix} terminal={terminal} />
      ))}
    </div>
  );
}
