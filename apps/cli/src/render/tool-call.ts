import { sanitizeTerminalText } from "../output/sanitize.js";
import { normalizePath } from "./path.js";

export interface ToolCallSummary {
  verb: string;
  primaryArg: string;
  secondaryDetail?: string;
}

const PATH_KEYS = ["path", "file_path", "filePath", "file", "target_file", "absolute_path", "filename"];
const COMMAND_KEYS = ["command", "cmd", "script", "command_line"];
const PATTERN_KEYS = ["pattern", "regex", "query", "glob"];
const QUERY_KEYS = ["query", "q", "search", "search_term", "searchTerm", "prompt"];
const URL_KEYS = ["url", "uri", "href"];
const SCOPE_KEYS = ["path", "directory", "dir", "include", "search_path"];

type Category = "read" | "write" | "edit" | "glob" | "grep" | "shell" | "web_search" | "web_fetch" | "generic";

// Canonical names from the spec plus the common aliases the Cursor/Claude tool
// surfaces use. Anything unmatched falls through to the generic extractor, which
// still produces a readable line — so a wrong guess degrades, it does not break.
const ALIASES: Record<string, Category> = {
  read: "read", read_file: "read", readfile: "read", view: "read", cat: "read",
  write: "write", write_file: "write", writefile: "write", create_file: "write", create: "write",
  edit: "edit", edit_file: "edit", str_replace: "edit", str_replace_editor: "edit", str_replace_based_edit_tool: "edit", apply_patch: "edit", search_replace: "edit", multiedit: "edit",
  glob: "glob", file_search: "glob", find_files: "glob",
  grep: "grep", grep_search: "grep", ripgrep: "grep", search_files: "grep",
  shell: "shell", bash: "shell", sh: "shell", run_terminal_cmd: "shell", run_command: "shell", terminal: "shell", exec: "shell", execute: "shell",
  web_search: "web_search", websearch: "web_search", search_web: "web_search",
  web_fetch: "web_fetch", webfetch: "web_fetch", fetch: "web_fetch", fetch_url: "web_fetch", read_url: "web_fetch", open_url: "web_fetch",
};

/**
 * Turn a tool call into a semantic one-line summary `{verb} {primaryArg}{detail?}`.
 * Never emits raw JSON on the happy path: known tools get tailored extractors,
 * unknown tools fall back to `{name} {first-string-arg-or-key}`. Path-valued args
 * are run through {@link normalizePath} so the display matches the rest of the UI.
 */
export function formatToolCall(toolName: string, args: unknown, cwd: string): ToolCallSummary {
  const category = ALIASES[normalizeName(toolName)] ?? "generic";
  const rec = asRecord(args);
  return clean(extract(category, toolName, rec, args, cwd));
}

function extract(category: Category, toolName: string, rec: Record<string, unknown> | null, args: unknown, cwd: string): ToolCallSummary {
  switch (category) {
    case "read":
    case "write":
    case "edit":
      return pathTool(category, rec, args, cwd);
    case "glob":
    case "grep":
      return searchTool(category, rec, args, cwd);
    case "shell":
      return { verb: "shell", primaryArg: pickString(rec, COMMAND_KEYS) ?? asString(args) ?? "" };
    case "web_search":
      return { verb: "search", primaryArg: pickString(rec, QUERY_KEYS) ?? asString(args) ?? "" };
    case "web_fetch":
      return { verb: "fetch", primaryArg: pickString(rec, URL_KEYS) ?? asString(args) ?? "" };
    default:
      return genericTool(toolName, rec, args, cwd);
  }
}

function pathTool(verb: string, rec: Record<string, unknown> | null, args: unknown, cwd: string): ToolCallSummary {
  const target = pickString(rec, PATH_KEYS);
  if (target !== undefined) return { verb, primaryArg: normalizePath(target, cwd) };
  return { ...genericTool(verb, rec, args, cwd), verb };
}

function searchTool(verb: string, rec: Record<string, unknown> | null, args: unknown, cwd: string): ToolCallSummary {
  const pattern = pickString(rec, PATTERN_KEYS) ?? asString(args);
  const scope = pickString(rec, SCOPE_KEYS);
  const base: ToolCallSummary = pattern !== undefined ? { verb, primaryArg: pattern } : { ...genericTool(verb, rec, args, cwd), verb };
  return scope !== undefined ? { ...base, secondaryDetail: `in ${normalizePath(scope, cwd)}` } : base;
}

function genericTool(toolName: string, rec: Record<string, unknown> | null, args: unknown, cwd: string): ToolCallSummary {
  const verb = toolName || "tool";
  const direct = asString(args);
  if (direct !== undefined) return { verb, primaryArg: maybePath(direct, cwd) };
  if (!rec) return { verb, primaryArg: "" };
  const firstString = pickString(rec, Object.keys(rec));
  if (firstString !== undefined) return { verb, primaryArg: maybePath(firstString, cwd) };
  return { verb, primaryArg: Object.keys(rec)[0] ?? "" };
}

function maybePath(value: string, cwd: string): string {
  return /^[~/]|^\.\.?\//.test(value) ? normalizePath(value, cwd) : value;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickString(rec: Record<string, unknown> | null, keys: readonly string[]): string | undefined {
  if (!rec) return undefined;
  for (const key of keys) {
    const value = asString(rec[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function clean(summary: ToolCallSummary): ToolCallSummary {
  const verb = collapse(sanitizeTerminalText(summary.verb)) || "tool";
  const primaryArg = collapse(sanitizeTerminalText(summary.primaryArg));
  const out: ToolCallSummary = { verb, primaryArg };
  const detail = summary.secondaryDetail ? collapse(sanitizeTerminalText(summary.secondaryDetail)) : "";
  if (detail) out.secondaryDetail = detail;
  return out;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
