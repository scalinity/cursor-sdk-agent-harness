import { sanitizeTerminalText } from "../output/sanitize.js";
import { styles } from "./styles.js";

const MAX_DIFF_LINES = 15;
const NEW_FILE_PREVIEW_LINES = 5;

export interface DiffRenderOptions {
  maxLines?: number;
}

export function renderDiff(diff: string, options: DiffRenderOptions = {}): string {
  const maxLines = options.maxLines ?? MAX_DIFF_LINES;
  const lines = sanitizeTerminalText(diff).split("\n");
  const visible = lines.slice(0, maxLines);
  const rendered = visible.map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return styles.diffAdd(line);
    if (line.startsWith("-") && !line.startsWith("---")) return styles.diffDel(line);
    if (line.startsWith("@@")) return styles.diffMeta(line);
    return styles.diffContext(line);
  });
  const remaining = lines.length - visible.length;
  if (remaining > 0) rendered.push(styles.diffContext(`... +${remaining} more lines`));
  return rendered.join("\n");
}

export interface FileEdit {
  path: string;
  language?: string;
  before?: string;
  after?: string;
  unifiedDiff?: string;
}

// ASSUMPTION: file-edit previews are driven by the server's derived.code_edit
// event (path/before/after/unifiedDiff), the established edit-preview channel
// per RENDERING_AUDIT.md — not from raw write/edit tool args. Flag if wrong.
export function renderFileEdit(edit: FileEdit): string {
  const path = sanitizeTerminalText(edit.path);
  if (looksBinary(edit.after) || looksBinary(edit.before)) {
    const size = byteLength(edit.after ?? edit.before ?? "");
    return styles.frame(`wrote ${path} (${formatBytes(size)})`);
  }
  if (isNewFile(edit)) {
    return renderNewFileSnippet(path, edit.after ?? "");
  }
  const diff = edit.unifiedDiff ?? buildFallbackDiff(edit.before, edit.after);
  return `${styles.frame(`┌─ ${path} ─`)}\n${renderDiff(diff)}\n${styles.frame("└────────")}`;
}

function renderNewFileSnippet(path: string, after: string): string {
  const lines = sanitizeTerminalText(after.replace(/\n$/, "")).split("\n");
  const shown = lines.slice(0, NEW_FILE_PREVIEW_LINES);
  const body = shown.map((line) => styles.diffAdd(`+ ${line}`)).join("\n");
  const remaining = lines.length - shown.length;
  const more = remaining > 0 ? `\n${styles.diffContext(`... +${remaining} more lines`)}` : "";
  return `${styles.frame(`┌─ wrote ${path} ─`)}\n${body}${more}\n${styles.frame("└────────")}`;
}

function isNewFile(edit: FileEdit): boolean {
  const hasBefore = edit.before !== undefined && edit.before.length > 0;
  return !hasBefore && edit.after !== undefined && edit.after.length > 0;
}

function buildFallbackDiff(before: string | undefined, after: string | undefined): string {
  if (before === undefined && after === undefined) return "";
  return [`-${before ?? ""}`, `+${after ?? ""}`].join("\n");
}

function looksBinary(value: string | undefined): boolean {
  if (!value) return false;
  // NUL or C0 control chars (other than tab/newline/CR) in the first chunk → binary.
  const sample = value.slice(0, 8000);
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    if (code === 0) return true;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
