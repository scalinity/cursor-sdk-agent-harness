import { memo, createElement } from "react";
import type { KnownLanguage } from "@harness/shared";
import type { MarkdownBlock } from "../../lib/streaming-markdown-projector.js";
import { detectLanguageFromPath } from "../../lib/code-edit-events.js";
import { StreamingText } from "./StreamingText.js";
import { SyntaxHighlighter } from "./SyntaxHighlighter.js";

export interface MarkdownBlockViewProps {
  block: MarkdownBlock;
  streamIdPrefix: string;
  terminal: boolean;
}

function languageClass(language: string | null): string {
  const normalized = language?.replace(/[^a-zA-Z0-9_-]/g, "") || "plain";
  return `mono lang-${normalized}`;
}

function languageFromFence(language: string | null): KnownLanguage {
  const normalized = language?.toLowerCase() ?? "";
  if (["ts", "tsx", "typescript"].includes(normalized)) return "typescript";
  if (["js", "jsx", "javascript", "mjs", "cjs"].includes(normalized)) return "javascript";
  if (["py", "python"].includes(normalized)) return "python";
  if (normalized === "json") return "json";
  if (["md", "mdx", "markdown"].includes(normalized)) return "markdown";
  if (["sh", "bash", "zsh", "shell"].includes(normalized)) return "shell";
  return detectLanguageFromPath(`snippet.${normalized || "txt"}`);
}

function streamId(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

function openBlockBadge(terminal: boolean): string {
  return terminal ? "unterminated" : "streaming...";
}

function MarkdownBlockViewImpl({ block, streamIdPrefix, terminal }: MarkdownBlockViewProps) {
  if (block.type === "paragraph") {
    return (
      <p className="streaming-md__p">
        <StreamingText text={block.text} streamId={streamId(streamIdPrefix, block.id)} />
      </p>
    );
  }
  if (block.type === "heading") {
    return createElement(
      `h${block.level}`,
      { className: `streaming-md__h streaming-md__h${block.level}` },
      <StreamingText text={block.text} streamId={streamId(streamIdPrefix, block.id)} />,
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className="streaming-md__list">
        {block.items.map((item) => (
          <li key={item.id}>
            <StreamingText text={item.text} streamId={streamId(streamIdPrefix, item.id)} />
          </li>
        ))}
      </Tag>
    );
  }
  if (block.type === "blockquote") {
    return (
      <blockquote className="streaming-md__quote">
        <StreamingText text={block.text} streamId={streamId(streamIdPrefix, block.id)} />
      </blockquote>
    );
  }
  if (block.type === "code") {
    const language = languageFromFence(block.language);
    return (
      <pre className="streaming-md__code">
        <SyntaxHighlighter language={language} text={block.text} className={languageClass(block.language)} />
        {!block.closed ? <span className="streaming-md__badge">{openBlockBadge(terminal)}</span> : null}
      </pre>
    );
  }
  if (block.type === "table") {
    return (
      <div className="streaming-md__table-wrap">
        <table className="streaming-md__table">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${block.id}-row-${rowIndex.toString()}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${block.id}-cell-${rowIndex.toString()}-${cellIndex.toString()}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!block.closed ? <span className="streaming-md__badge">{openBlockBadge(terminal)}</span> : null}
      </div>
    );
  }
  return <hr className="streaming-md__rule" />;
}

export const MarkdownBlockView = memo(MarkdownBlockViewImpl);
