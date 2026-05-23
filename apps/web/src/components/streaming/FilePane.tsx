import type { KnownLanguage } from "@harness/shared";
import {
  hashText,
  useIncrementalSyntaxHighlighter,
} from "../../hooks/useIncrementalSyntaxHighlighter.js";
import { cn } from "../../lib/cn.js";
import { renderHighlightedText } from "./SyntaxHighlighter.js";

export interface FilePaneProps {
  path: string;
  language: KnownLanguage;
  text: string;
  caretOffset?: number | undefined;
  deletedText?: string | undefined;
  compact?: boolean | undefined;
}

interface LineRange {
  text: string;
  from: number;
  to: number;
  lineNumber: number;
}

function splitLines(text: string): LineRange[] {
  if (text.length === 0) return [{ text: "", from: 0, to: 0, lineNumber: 1 }];
  const rawLines = text.split("\n");
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();
  let offset = 0;
  return rawLines.map((line, index) => {
    const from = offset;
    const to = from + line.length;
    offset = to + 1;
    return { text: line, from, to, lineNumber: index + 1 };
  });
}

function currentLine(line: LineRange, caretOffset: number | undefined): boolean {
  if (caretOffset === undefined) return false;
  return caretOffset >= line.from && caretOffset <= line.to + 1;
}

export function FilePane({ path, language, text, caretOffset, deletedText, compact }: FilePaneProps) {
  const decorations = useIncrementalSyntaxHighlighter({
    language,
    text,
    version: hashText(text),
    cacheKey: path,
  });
  const lines = splitLines(text);
  const deletedLines = deletedText ? splitLines(deletedText) : [];

  return (
    <section className={cn("code-edit-file", compact && "code-edit-file--compact")}>
      <header className="code-edit-file__head">
        <span className="mono code-edit-file__path">{path}</span>
        <span className="mono code-edit-file__lang">{language}</span>
      </header>
      <div className="editor" data-testid={`code-edit-editor-${path}`}>
        {deletedLines.map((line) => (
          <div key={`del-${line.lineNumber.toString()}`} className="erow del">
            <span className="gl">{line.lineNumber}</span>
            <span className="sg">-</span>
            <span className="src code-edit-deleted">{line.text || " "}</span>
          </div>
        ))}
        {lines.map((line) => (
          <div
            key={`add-${line.lineNumber.toString()}`}
            className={cn("erow", text.length > 0 && "add", currentLine(line, caretOffset) && "current")}
          >
            <span className="gl">{line.lineNumber}</span>
            <span className="sg">{text.length > 0 ? "+" : " "}</span>
            <span className="src">
              {renderHighlightedText(
                line.text,
                decorations.filter((decoration) => decoration.to > line.from && decoration.from < line.to),
                caretOffset,
                line.from,
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
