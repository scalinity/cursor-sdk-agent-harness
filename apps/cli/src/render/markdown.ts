import chalk from "chalk";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { renderCodeBlock } from "./code-block.js";

export interface MarkdownRenderOptions {
  columns?: number;
}

function renderInline(input: string): string {
  let output = input.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => `${chalk.underline(label)} ${chalk.dim(`(${url})`)}`);
  output = output.replace(/`([^`]+)`/g, (_match, code: string) => chalk.inverse.cyan(` ${code} `));
  output = output.replace(/\*\*([^*]+)\*\*/g, (_match, text: string) => chalk.bold(text));
  output = output.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, (_match, prefix: string, text: string) => `${prefix}${chalk.italic(text)}`);
  return output;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const current = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return current.trim().startsWith("|") && next.trim().startsWith("|") && /\|?\s*:?-{3,}:?\s*(\||$)/.test(next.trim());
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((part) => part.trim());
}

function renderTable(lines: readonly string[]): string {
  const rows = lines.filter((line, index) => index !== 1).map(parseTableRow);
  const widths = rows[0]?.map((_cell, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? [];
  return rows
    .map((row) => row.map((cell, column) => (cell ?? "").padEnd(widths[column] ?? 0)).join("  "))
    .join("\n");
}

export function renderMarkdown(markdown: string, options: MarkdownRenderOptions = {}): string {
  const lines = sanitizeTerminalText(markdown).split("\n");
  const rendered: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.match(/^```([^`]*)\s*$/);
    if (fence) {
      const language = fence[1]?.trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const codeOptions: { language?: string; columns?: number } = {};
      if (language !== undefined) codeOptions.language = language;
      if (options.columns !== undefined) codeOptions.columns = options.columns;
      rendered.push(renderCodeBlock(body.join("\n"), codeOptions));
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      rendered.push(renderTable(tableLines));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      rendered.push(chalk.bold(`${heading[1]} ${renderInline(heading[2] ?? "")}`));
    } else if (line.startsWith(">")) {
      rendered.push(chalk.dim(`│ ${renderInline(line.replace(/^>\s?/, ""))}`));
    } else {
      rendered.push(renderInline(line));
    }
    index += 1;
  }
  return rendered.join("\n");
}
