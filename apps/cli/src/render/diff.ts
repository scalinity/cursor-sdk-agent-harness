import chalk from "chalk";
import { sanitizeTerminalText } from "../output/sanitize.js";

export interface DiffRenderOptions {
  maxLines?: number;
}

export function renderDiff(diff: string, options: DiffRenderOptions = {}): string {
  const maxLines = options.maxLines ?? 20;
  const lines = sanitizeTerminalText(diff).split("\n");
  const visible = lines.slice(0, maxLines);
  const rendered = visible.map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return chalk.green(line);
    if (line.startsWith("-") && !line.startsWith("---")) return chalk.red(line);
    if (line.startsWith("@@")) return chalk.cyan(line);
    return chalk.dim(line);
  });
  const remaining = lines.length - visible.length;
  if (remaining > 0) rendered.push(chalk.dim(`[+${remaining} more lines]`));
  return rendered.join("\n");
}
