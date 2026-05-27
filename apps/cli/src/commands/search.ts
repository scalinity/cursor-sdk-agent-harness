import { CliUsageError } from "../errors.js";
import { writeJsonLine } from "../output/json.js";
import { sanitizeTerminalText } from "../output/sanitize.js";
import type { CommandDeps } from "../types.js";
import { styles } from "../render/styles.js";

export interface SearchCommandOptions {
  query: string;
  workspace?: string;
  maxResults?: number;
  filesOnly?: boolean;
  json?: boolean;
}

export async function searchWorkspace(options: SearchCommandOptions, deps: Pick<CommandDeps, "http" | "write">): Promise<void> {
  if (options.workspace !== undefined) {
    throw new CliUsageError("search --workspace is not supported by the grep/files endpoints yet; set the active workspace in the app or omit the flag.");
  }
  if (options.filesOnly) {
    const result = await deps.http.fileSearch({ pattern: options.query, maxResults: options.maxResults ?? 20 });
    if (options.json) {
      writeJsonLine(deps.write, { type: "file_search", result });
      return;
    }
    for (const file of result.files) deps.write(sanitizeTerminalText(file.path));
    return;
  }

  const query = { q: options.query, maxResults: options.maxResults ?? 20 };
  const result = await deps.http.grepSearch(query);
  if (options.json) {
    writeJsonLine(deps.write, { type: "grep_search", result });
    return;
  }
  for (const item of result.results) {
    const line = `${sanitizeTerminalText(item.path)}:${item.line}: ${highlight(item.content, options.query)}`;
    deps.write(line);
  }
}

function highlight(value: string, query: string): string {
  const safeValue = sanitizeTerminalText(value);
  const safeQuery = sanitizeTerminalText(query);
  const index = safeValue.toLowerCase().indexOf(safeQuery.toLowerCase());
  if (index === -1) return safeValue;
  return safeValue.slice(0, index) + styles.match(safeValue.slice(index, index + safeQuery.length)) + safeValue.slice(index + safeQuery.length);
}
