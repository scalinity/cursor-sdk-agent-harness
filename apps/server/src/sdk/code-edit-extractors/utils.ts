import type { KnownLanguage } from "@harness/shared";
import type { ExtractedCodeEditFile, ExtractedCodeEditOperation } from "./types.js";

const EXTENSION_LANGUAGE: ReadonlyArray<[RegExp, KnownLanguage]> = [
  [/\.tsx?$/i, "typescript"],
  [/\.(?:jsx?|mjs|cjs)$/i, "javascript"],
  [/\.py$/i, "python"],
  [/\.json$/i, "json"],
  [/\.(?:md|mdx)$/i, "markdown"],
  [/\.(?:sh|bash|zsh)$/i, "shell"],
];

export function inferLanguageFromPath(path: string): KnownLanguage {
  for (const [pattern, language] of EXTENSION_LANGUAGE) {
    if (pattern.test(path)) return language;
  }
  return "plain-text";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const out = value[key];
  return typeof out === "string" ? out : null;
}

export function getFirstString(value: unknown, keys: readonly string[]): string | null {
  for (const key of keys) {
    const out = getString(value, key);
    if (out !== null) return out;
  }
  return null;
}

export function getNested(value: unknown, path: readonly string[]): unknown {
  let cursor = value;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

export function getNestedString(value: unknown, path: readonly string[]): string | null {
  const out = getNested(value, path);
  return typeof out === "string" ? out : null;
}

export function resultValue(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if ("value" in result) return result.value;
  return result;
}

export function normalizedToolName(name: string): string {
  return name.toLowerCase().replace(/[\s-]+/g, "_");
}

export function hasToolName(name: string, names: ReadonlySet<string>): boolean {
  return names.has(normalizedToolName(name));
}

function isWordChar(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}

export function deriveTextOperations(before: string, after: string): ExtractedCodeEditOperation[] {
  if (before === after) return [];

  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;

  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  while (
    start > 0 &&
    isWordChar(before[start - 1]) &&
    isWordChar(after[start - 1]) &&
    (isWordChar(before[start]) || isWordChar(after[start]))
  ) {
    start -= 1;
  }

  const text = after.slice(start, newEnd);
  const type = start === oldEnd ? "insert" : text.length === 0 ? "delete" : "replace";
  return [{ type, startOffset: start, endOffset: oldEnd, text }];
}

export function makeSingleEdit(input: {
  path: string;
  before?: string;
  after?: string;
  unifiedDiff?: string;
  operations: ExtractedCodeEditOperation[];
}): ExtractedCodeEditFile {
  return {
    path: input.path,
    language: inferLanguageFromPath(input.path),
    ...(input.before !== undefined ? { before: input.before } : {}),
    ...(input.after !== undefined ? { after: input.after } : {}),
    ...(input.unifiedDiff !== undefined ? { unifiedDiff: input.unifiedDiff } : {}),
    operations: input.operations,
  };
}
