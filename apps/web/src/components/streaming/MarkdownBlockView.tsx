import { memo, createElement } from "react";
import type { KnownLanguage } from "@harness/shared";
import type { MarkdownBlock } from "../../lib/streaming-markdown-projector.js";
import { detectLanguageFromPath } from "../../lib/code-edit-events.js";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.js";
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

/**
 * Parse a filename from the fence language string. Some LLMs emit
 * `typescript src/foo.ts` — we extract the path-like token after the language.
 */
function parseFilenameFromFence(language: string | null): string | null {
  if (!language) return null;
  const parts = language.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const candidate = parts[parts.length - 1]!;
  // Must look path-like: contains a / or a . with an extension.
  if (candidate.includes("/") || /\.\w+$/.test(candidate)) return candidate;
  return null;
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.5 2A1.5 1.5 0 0 1 6 .5h2A1.5 1.5 0 0 1 9.5 2h1A1.5 1.5 0 0 1 12 3.5v8a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h1ZM6 2h2a.5.5 0 0 0 0-1H6a.5.5 0 0 0 0 1Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckSmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7.5 5.5 10 11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ApplyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1H3.5A1.5 1.5 0 0 0 2 2.5v9A1.5 1.5 0 0 0 3.5 13h7a1.5 1.5 0 0 0 1.5-1.5V5L8 1Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface CodeBlockProps {
  text: string;
  language: KnownLanguage;
  languageRaw: string | null;
  closed: boolean;
  terminal: boolean;
}

/**
 * CodeBlock — extracted from MarkdownBlockViewImpl so it can safely call hooks
 * (useCopyToClipboard). The ESLint rule bans useEffect in components/ but the
 * copy hook lives in hooks/ — only the _hook call_ happens here, which is
 * legal in any React component.
 */
function CodeBlock({ text, language, languageRaw, closed, terminal }: CodeBlockProps) {
  const { copied, copy } = useCopyToClipboard();
  const filename = parseFilenameFromFence(languageRaw);

  const handleApply = () => {
    if (!filename) return;
    // Fire-and-forget. CSRF token is read from the store at call time.
    // We use the raw fetch approach since this is a simple POST.
    const csrf = (
      document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null
    )?.content;
    void fetch("/api/files/write", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify({ path: filename, content: text }),
    });
  };

  return (
    <pre className="streaming-md__code group relative">
      <SyntaxHighlighter language={language} text={text} className={languageClass(languageRaw)} />
      {!closed ? <span className="streaming-md__badge">{openBlockBadge(terminal)}</span> : null}
      <span className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {filename ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-2xs text-text-tertiary transition-colors hover:text-text-primary"
            onClick={handleApply}
            title={`Apply to ${filename}`}
            aria-label={`Apply to ${filename}`}
          >
            <ApplyIcon className="size-3.5" />
            <span>Apply</span>
          </button>
        ) : null}
        <button
          type="button"
          className="flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-2xs text-text-tertiary transition-colors hover:text-text-primary"
          onClick={() => copy(text)}
          title={copied ? "Copied!" : "Copy"}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <CheckSmallIcon className="size-3.5" /> : <ClipboardIcon className="size-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </span>
    </pre>
  );
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
      <CodeBlock
        text={block.text}
        language={language}
        languageRaw={block.language}
        closed={block.closed}
        terminal={terminal}
      />
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
