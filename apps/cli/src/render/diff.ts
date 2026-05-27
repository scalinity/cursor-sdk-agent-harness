import { sanitizeTerminalText } from "../output/sanitize.js";
import { styles } from "./styles.js";

export interface DiffRenderOptions {
  maxLines?: number;
}

export function renderDiff(diff: string, options: DiffRenderOptions = {}): string {
  const maxLines = options.maxLines ?? 20;
  const lines = sanitizeTerminalText(diff).split("\n");
  const visible = lines.slice(0, maxLines);
  const rendered = visible.map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return styles.diffAdd(line);
    if (line.startsWith("-") && !line.startsWith("---")) return styles.diffDel(line);
    if (line.startsWith("@@")) return styles.diffMeta(line);
    return styles.diffContext(line);
  });
  const remaining = lines.length - visible.length;
  if (remaining > 0) rendered.push(styles.diffContext(`[+${remaining} more lines]`));
  return rendered.join("\n");
}
