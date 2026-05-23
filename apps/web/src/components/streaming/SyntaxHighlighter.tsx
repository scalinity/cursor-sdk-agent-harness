import type { ReactNode } from "react";
import type { KnownLanguage } from "@harness/shared";
import {
  hashText,
  useIncrementalSyntaxHighlighter,
  type ChangedRange,
  type Decoration,
} from "../../hooks/useIncrementalSyntaxHighlighter.js";
import { cn } from "../../lib/cn.js";

export interface SyntaxHighlighterProps {
  language: KnownLanguage;
  text: string;
  changedRange?: ChangedRange | undefined;
  caretOffset?: number | undefined;
  className?: string | undefined;
  cacheKey?: string | undefined;
}

function withCaret(text: string, caretOffset: number | undefined, absoluteFrom: number): ReactNode[] {
  if (caretOffset === undefined || caretOffset < absoluteFrom || caretOffset > absoluteFrom + text.length) {
    return [text];
  }
  const local = caretOffset - absoluteFrom;
  return [
    text.slice(0, local),
    <span key="caret" className="caret-anim" aria-hidden="true" />,
    text.slice(local),
  ];
}

export function renderHighlightedText(
  text: string,
  decorations: readonly Decoration[],
  caretOffset?: number,
  baseOffset = 0,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const endOffset = baseOffset + text.length;
  let cursor = baseOffset;

  for (const decoration of decorations) {
    const from = Math.max(decoration.from, baseOffset);
    const to = Math.min(decoration.to, endOffset);
    if (to <= from) continue;
    if (from > cursor) {
      nodes.push(...withCaret(text.slice(cursor - baseOffset, from - baseOffset), caretOffset, cursor));
    }
    nodes.push(
      <span key={`${from.toString()}-${to.toString()}-${decoration.className}`} className={decoration.className}>
        {withCaret(text.slice(from - baseOffset, to - baseOffset), caretOffset, from)}
      </span>,
    );
    cursor = to;
  }

  if (cursor < endOffset) {
    nodes.push(...withCaret(text.slice(cursor - baseOffset), caretOffset, cursor));
  } else if (caretOffset === endOffset) {
    nodes.push(<span key="caret-end" className="caret-anim" aria-hidden="true" />);
  }

  return nodes.length > 0 ? nodes : withCaret(text, caretOffset, baseOffset);
}

export function SyntaxHighlighter({
  language,
  text,
  changedRange,
  caretOffset,
  className,
  cacheKey,
}: SyntaxHighlighterProps) {
  const decorations = useIncrementalSyntaxHighlighter({
    language,
    text,
    version: hashText(text),
    changedRange,
    cacheKey,
  });

  return (
    <code className={cn("syntax-highlighter", className)}>
      {renderHighlightedText(text, decorations, caretOffset)}
    </code>
  );
}
