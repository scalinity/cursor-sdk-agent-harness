import chalk from "chalk";
import { writeJsonLine } from "../output/json.js";
import type { CommandDeps } from "../types.js";

export interface SearchCommandOptions {
  query: string;
  workspace?: string;
  maxResults?: number;
  filesOnly?: boolean;
  json?: boolean;
}

export async function searchWorkspace(options: SearchCommandOptions, deps: Pick<CommandDeps, "http" | "write">): Promise<void> {
  if (options.filesOnly) {
    const result = await deps.http.fileSearch({ pattern: options.query, maxResults: options.maxResults ?? 20, workspaceId: options.workspace });
    if (options.json) {
      writeJsonLine(deps.write, { type: "file_search", result });
      return;
    }
    for (const file of filesFromUnknown(result)) deps.write(file.path);
    return;
  }

  const query = { q: options.query, maxResults: options.maxResults ?? 20, workspaceId: options.workspace };
  const result = await deps.http.grepSearch(query);
  if (options.json) {
    writeJsonLine(deps.write, { type: "grep_search", result });
    return;
  }
  for (const item of grepItemsFromUnknown(result)) {
    const line = `${item.path}:${item.line}: ${highlight(item.content, options.query)}`;
    deps.write(line);
  }
}

function highlight(value: string, query: string): string {
  const index = value.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return value;
  return value.slice(0, index) + chalk.inverse(value.slice(index, index + query.length)) + value.slice(index + query.length);
}

function grepItemsFromUnknown(value: unknown): Array<{ path: string; line: number; content: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.line !== "number") return [];
    const content = typeof record.content === "string" ? record.content : typeof record.text === "string" ? record.text : "";
    return [{ path: record.path, line: record.line, content }];
  });
}

function filesFromUnknown(value: unknown): Array<{ path: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const files = (value as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const path = (item as Record<string, unknown>).path;
    return typeof path === "string" ? [{ path }] : [];
  });
}
