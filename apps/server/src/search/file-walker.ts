import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";

/**
 * Phase 23 — Workspace file selection for indexing.
 *
 * Walks a workspace tree, selecting source files by extension while skipping
 * dependency/build dirs, oversized files, and paths matched by .gitignore /
 * .cursorindexignore. The gitignore handling is pragmatic (root-level
 * patterns, no negation precedence) — the hardcoded skip set covers the
 * heavy hitters (node_modules, dist, .git).
 */

export const DEFAULT_INDEXED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".md",
  ".json",
] as const;

export const MAX_INDEXED_FILE_BYTES = 100 * 1024;

export const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
  "vendor",
  "target",
  "__pycache__",
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".md": "markdown",
  ".json": "json",
};

export function detectLanguage(filePath: string): string | null {
  return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] ?? null;
}

export interface WalkOptions {
  extensions?: readonly string[];
  maxFileBytes?: number;
  ignorePatterns?: readonly string[];
}

export interface WalkedFile {
  absPath: string;
  relPath: string;
  size: number;
}

/** Read .gitignore + .cursorindexignore at the workspace root into raw patterns. */
export async function loadIgnorePatterns(root: string): Promise<string[]> {
  const patterns: string[] = [];
  for (const name of [".gitignore", ".cursorindexignore"]) {
    try {
      const raw = await fs.readFile(path.join(root, name), "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
        patterns.push(trimmed);
      }
    } catch {
      // No ignore file — fine.
    }
  }
  return patterns;
}

function matchesIgnore(relPath: string, patterns: readonly string[]): boolean {
  for (const raw of patterns) {
    let p = raw;
    const anchored = p.startsWith("/");
    if (anchored) p = p.slice(1);
    if (p.endsWith("/")) p = p.slice(0, -1);
    if (p.length === 0) continue;
    const opts = { dot: true, nocomment: true };
    const candidates = anchored
      ? [p, `${p}/**`]
      : [p, `**/${p}`, `**/${p}/**`, `${p}/**`];
    if (candidates.some((pattern) => minimatch(relPath, pattern, opts))) return true;
  }
  return false;
}

export async function walkWorkspace(
  root: string,
  options: WalkOptions = {},
): Promise<WalkedFile[]> {
  const extensions = new Set(options.extensions ?? DEFAULT_INDEXED_EXTENSIONS);
  const maxBytes = options.maxFileBytes ?? MAX_INDEXED_FILE_BYTES;
  const ignorePatterns = options.ignorePatterns ?? [];
  const out: WalkedFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      // P23-C2: never follow symlinks. `Dirent.isDirectory()`/`isFile()` are
      // false for a symlink (they reflect the link, not its target), so the
      // branches below already skip them — but make it explicit + defensive so
      // a symlinked dir can never be traversed out of the workspace root, and
      // realpath-gate any entry whose resolved target escapes root.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (matchesIgnore(rel, ignorePatterns)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (matchesIgnore(rel, ignorePatterns)) continue;
      let size: number;
      try {
        const st = await fs.stat(abs);
        size = st.size;
      } catch {
        continue;
      }
      if (size > maxBytes || size === 0) continue;
      out.push({ absPath: abs, relPath: rel, size });
    }
  }

  await walk(root);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}
