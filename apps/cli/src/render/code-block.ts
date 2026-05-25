import chalk from "chalk";
import { sanitizeTerminalText } from "../output/sanitize.js";

export interface CodeBlockOptions {
  language?: string;
  columns?: number;
}

function visibleWidth(value: string): number {
  return value.length;
}

export function renderCodeBlock(code: string, options: CodeBlockOptions = {}): string {
  const safeCode = sanitizeTerminalText(code);
  const safeLanguage = options.language ? sanitizeTerminalText(options.language) : undefined;
  const label = safeLanguage && safeLanguage.length > 0 ? ` ${safeLanguage} ` : " code ";
  const rawLines = safeCode.length > 0 ? safeCode.replace(/\n$/, "").split("\n") : [""];
  const maxContent = Math.max(...rawLines.map(visibleWidth), label.length + 2, 8);
  const terminalWidth = Math.max(20, options.columns ?? process.stdout.columns ?? 80);
  const innerWidth = Math.min(maxContent + 2, terminalWidth - 4);
  const topFill = "─".repeat(Math.max(1, innerWidth - label.length));
  const top = `┌─${label}${topFill}┐`;
  const body = rawLines.map((line) => {
    const contentWidth = Math.max(0, innerWidth - 2);
    const clipped = line.length > contentWidth ? `${line.slice(0, Math.max(0, contentWidth - 1))}…` : line;
    return `│  ${clipped.padEnd(contentWidth)}│`;
  });
  const bottom = `└${"─".repeat(innerWidth + 1)}┘`;
  return chalk.dim(top) + "\n" + body.join("\n") + "\n" + chalk.dim(bottom);
}
