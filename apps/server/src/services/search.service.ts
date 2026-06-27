import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const execFile = promisify(execFileCb);

let hasRipgrep: boolean | null = null;

async function detectRipgrep(): Promise<boolean> {
  if (hasRipgrep !== null) return hasRipgrep;
  try {
    await execFile("rg", ["--version"], { timeout: 3000 });
    hasRipgrep = true;
  } catch {
    hasRipgrep = false;
  }
  return hasRipgrep;
}

export interface GrepSearchOptions {
  query: string;
  workspaceRoot: string;
  maxResults: number;
  filePattern?: string | undefined;
  caseSensitive: boolean;
}

export interface GrepMatch {
  path: string;
  line: number;
  column: number;
  content: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface GrepSearchOutput {
  results: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
  durationMs: number;
}

function parseGrepOutput(stdout: string, workspaceRoot: string): GrepMatch[] {
  const results: GrepMatch[] = [];
  const lines = stdout.split("\n").filter(Boolean);

  // Group by separator "--" (context groups)
  type Group = { path: string; lineNo: number; col: number; text: string; before: string[]; after: string[] };
  let currentGroup: Group | null = null;
  let afterCount = 0;

  const flushGroup = (group: Group): void => {
    results.push({
      path: group.path,
      line: group.lineNo,
      column: group.col,
      content: group.text,
      contextBefore: group.before,
      contextAfter: group.after,
    });
  };

  for (const line of lines) {
    if (line === "--") {
      if (currentGroup) {
        flushGroup(currentGroup);
        currentGroup = null;
        afterCount = 0;
      }
      continue;
    }

    // Match line: rg format file:lineNo:colNo:content OR grep format file:lineNo:content
    const rgMatch = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
    const grepMatch = !rgMatch ? line.match(/^(.+?):(\d+):(.*)$/) : null;
    const matchResult = rgMatch ?? (grepMatch ? [grepMatch[0], grepMatch[1], grepMatch[2], "1", grepMatch[3]] : null);
    if (matchResult) {
      if (currentGroup && afterCount <= 2) {
        flushGroup(currentGroup);
      }
      const relPath = path.relative(workspaceRoot, path.resolve(workspaceRoot, matchResult[1]!));
      currentGroup = {
        path: relPath,
        lineNo: parseInt(matchResult[2]!, 10),
        col: parseInt(matchResult[3]!, 10),
        text: matchResult[4]!,
        before: [],
        after: [],
      };
      afterCount = 0;
      continue;
    }

    // Context line (before/after match) — greedy .+ to handle filenames with hyphens
    const ctxResult = line.match(/^(.+)-(\d+)-(.*)$/);
    if (ctxResult && currentGroup) {
      const ctxLineNo = parseInt(ctxResult[2]!, 10);
      if (ctxLineNo < currentGroup.lineNo) {
        currentGroup.before.push(ctxResult[3]!);
      } else {
        if (afterCount < 2) {
          currentGroup.after.push(ctxResult[3]!);
          afterCount++;
        }
      }
    }
  }

  if (currentGroup) {
    flushGroup(currentGroup);
  }

  return results;
}

export async function grepSearch(opts: GrepSearchOptions): Promise<GrepSearchOutput> {
  const start = performance.now();
  const useRg = await detectRipgrep();

  let stdout = "";

  const command = useRg ? "rg" : "grep";
  let args: string[];
  if (useRg) {
    args = [
      "--no-heading",
      "--column",
      "--line-number",
      "--context", "2",
      "--max-count", String(opts.maxResults),
      "--color", "never",
    ];
    if (!opts.caseSensitive) args.push("--ignore-case");
    if (opts.filePattern) args.push("--glob", opts.filePattern);
  } else {
    args = [
      "-rn",
      "--include=*.ts", "--include=*.tsx", "--include=*.js", "--include=*.jsx",
      "--include=*.json", "--include=*.md", "--include=*.css", "--include=*.html",
      "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist",
      "--exclude-dir=build", "--exclude-dir=coverage",
      "-C", "2",
    ];
    if (!opts.caseSensitive) args.push("-i");
  }
  args.push("--", opts.query, ".");

  try {
    const result = await execFile(command, args, {
      cwd: opts.workspaceRoot,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    // grep/rg exit 1 = no matches, exit 2 = error
    if (typeof err === "object" && err !== null && "code" in err) {
      const exitCode = (err as { code: number }).code;
      if (exitCode === 1) {
        return { results: [], totalMatches: 0, truncated: false, durationMs: performance.now() - start };
      }
    }
    if (typeof err === "object" && err !== null && "stdout" in err) {
      stdout = (err as { stdout: string }).stdout ?? "";
    }
    if (!stdout) {
      return { results: [], totalMatches: 0, truncated: false, durationMs: performance.now() - start };
    }
  }

  const allResults = parseGrepOutput(stdout, opts.workspaceRoot);
  const truncated = allResults.length > opts.maxResults;
  const results = allResults.slice(0, opts.maxResults);
  const durationMs = Math.round(performance.now() - start);

  return { results, totalMatches: allResults.length, truncated, durationMs };
}

export interface FileSearchOptions {
  pattern: string;
  workspaceRoot: string;
  maxResults: number;
}

export interface FileSearchItem {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface FileSearchOutput {
  files: FileSearchItem[];
  truncated: boolean;
}

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".harness",
  ".next", ".cache", ".turbo", "__pycache__",
]);

async function walkDir(
  dir: string,
  root: string,
  pattern: string,
  results: FileSearchItem[],
  maxResults: number,
  depth: number,
): Promise<void> {
  if (depth > 8 || results.length >= maxResults) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".harness") continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);
    const isDir = entry.isDirectory();

    if (fuzzyMatch(entry.name, pattern) || fuzzyMatch(relPath, pattern)) {
      try {
        const stat = await fs.stat(fullPath);
        results.push({
          path: relPath,
          name: entry.name,
          size: isDir ? 0 : stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch { /* skip */ }
    }
    if (isDir) {
      await walkDir(fullPath, root, pattern, results, maxResults, depth + 1);
    }
  }
}

function fuzzyMatch(text: string, pattern: string): boolean {
  const lower = text.toLowerCase();
  const pLower = pattern.toLowerCase();
  if (lower.includes(pLower)) return true;
  // Simple fuzzy: every char of pattern appears in order in text
  let pi = 0;
  for (let i = 0; i < lower.length && pi < pLower.length; i++) {
    if (lower[i] === pLower[pi]) pi++;
  }
  return pi === pLower.length;
}

export async function fileSearch(opts: FileSearchOptions): Promise<FileSearchOutput> {
  const results: FileSearchItem[] = [];
  await walkDir(opts.workspaceRoot, opts.workspaceRoot, opts.pattern, results, opts.maxResults + 1, 0);

  const truncated = results.length > opts.maxResults;
  const files = results.slice(0, opts.maxResults);

  // Sort: exact name match > path contains > fuzzy
  const pLower = opts.pattern.toLowerCase();
  files.sort((a, b) => {
    const aExact = a.name.toLowerCase() === pLower ? 0 : 1;
    const bExact = b.name.toLowerCase() === pLower ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aContains = a.name.toLowerCase().includes(pLower) ? 0 : 1;
    const bContains = b.name.toLowerCase().includes(pLower) ? 0 : 1;
    return aContains - bContains;
  });

  return { files, truncated };
}
