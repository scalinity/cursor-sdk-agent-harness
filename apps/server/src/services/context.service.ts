import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContextMention, ResolvedMention, ContextSearchResult } from "@harness/shared";
import { grepSearch } from "./search.service.js";

const FILE_TRUNCATE_CHARS = 50_000;
const SYMBOL_TRUNCATE_CHARS = 10_000;
const FOLDER_MAX_ENTRIES = 200;
const CODEBASE_MAX_RESULTS = 10;
const CODEBASE_RESULT_MAX_CHARS = 500;

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

// ---------------------------------------------------------------------------
// Symbol extraction (lightweight regex scanner)
// ---------------------------------------------------------------------------

interface SymbolEntry {
  name: string;
  kind: "function" | "class" | "type" | "interface" | "variable" | "enum" | "method";
  path: string;
  line: number;
  preview: string;
}

const SYMBOL_PATTERNS = [
  { regex: /^export\s+(?:(?:default|async)\s+)*function\s+(\w+)/gm, kind: "function" as const },
  { regex: /^export\s+class\s+(\w+)/gm, kind: "class" as const },
  { regex: /^export\s+type\s+(\w+)/gm, kind: "type" as const },
  { regex: /^export\s+interface\s+(\w+)/gm, kind: "interface" as const },
  { regex: /^export\s+const\s+(\w+)/gm, kind: "variable" as const },
  { regex: /^export\s+enum\s+(\w+)/gm, kind: "enum" as const },
];

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

interface SymbolCache {
  symbols: SymbolEntry[];
  timestamp: number;
}

const symbolCaches = new Map<string, SymbolCache>();
const CACHE_TTL_MS = 60_000;

async function scanFileForSymbols(filePath: string, relPath: string): Promise<SymbolEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const symbols: SymbolEntry[] = [];

  for (const { regex, kind } of SYMBOL_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNo = content.slice(0, match.index).split("\n").length;
      const previewLines = lines.slice(lineNo - 1, lineNo + 2).join("\n");
      symbols.push({
        name: match[1]!,
        kind,
        path: relPath,
        line: lineNo,
        preview: previewLines,
      });
    }
  }

  return symbols;
}

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".cache",
]);

async function collectSymbols(workspaceRoot: string): Promise<SymbolEntry[]> {
  const cached = symbolCaches.get(workspaceRoot);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.symbols;
  }

  const symbols: SymbolEntry[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (TS_EXTENSIONS.has(path.extname(entry.name))) {
        const relPath = path.relative(workspaceRoot, full);
        const fileSymbols = await scanFileForSymbols(full, relPath);
        symbols.push(...fileSymbols);
      }
    }
  }

  await walk(workspaceRoot, 0);
  if (symbolCaches.size >= 5) {
    const oldest = [...symbolCaches.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) symbolCaches.delete(oldest[0]);
  }
  symbolCaches.set(workspaceRoot, { symbols, timestamp: Date.now() });
  return symbols;
}

// ---------------------------------------------------------------------------
// Context search (autocomplete)
// ---------------------------------------------------------------------------

export async function contextSearch(
  query: string,
  workspaceRoot: string,
  kinds?: string[],
): Promise<ContextSearchResult> {
  const wantFiles = !kinds || kinds.includes("file") || kinds.includes("folder");
  const wantSymbols = !kinds || kinds.includes("symbol");

  const result: ContextSearchResult = { files: [], symbols: [] };
  const qLower = query.toLowerCase();

  if (wantFiles) {
    const files = await walkForFiles(workspaceRoot, qLower, 20);
    result.files = files;
  }

  if (wantSymbols) {
    const allSymbols = await collectSymbols(workspaceRoot);
    const matched = allSymbols
      .filter((s) => s.name.toLowerCase().includes(qLower))
      .slice(0, 20);
    result.symbols = matched;
  }

  return result;
}

async function walkForFiles(
  root: string,
  query: string,
  maxResults: number,
): Promise<Array<{ path: string; name: string; isDirectory: boolean; size?: number | undefined }>> {
  const results: Array<{ path: string; name: string; isDirectory: boolean; size?: number | undefined }> = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || results.length >= maxResults) return;
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

      const full = path.join(dir, entry.name);
      const relPath = path.relative(root, full);

      if (entry.name.toLowerCase().includes(query) || relPath.toLowerCase().includes(query)) {
        if (entry.isDirectory()) {
          results.push({ path: relPath, name: entry.name, isDirectory: true });
        } else {
          try {
            const stat = await fs.stat(full);
            results.push({ path: relPath, name: entry.name, isDirectory: false, size: stat.size });
          } catch {
            results.push({ path: relPath, name: entry.name, isDirectory: false });
          }
        }
      }

      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      }
    }
  }

  await walk(root, 0);

  // Sort: exact prefix > contains > rest
  results.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(query) ? 0 : 1;
    const bPrefix = b.name.toLowerCase().startsWith(query) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.name.localeCompare(b.name);
  });

  return results;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function assertWithinWorkspace(resolved: string, root: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedResolved = path.resolve(resolved);
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path traversal blocked: ${resolved} escapes workspace root`);
  }
}

// ---------------------------------------------------------------------------
// Content resolution
// ---------------------------------------------------------------------------

export async function resolveMention(
  mention: ContextMention,
  workspaceRoot: string,
): Promise<ResolvedMention> {
  switch (mention.kind) {
    case "file":
      return resolveFile(mention, workspaceRoot);
    case "folder":
      return resolveFolder(mention, workspaceRoot);
    case "symbol":
      return resolveSymbol(mention, workspaceRoot);
    case "codebase":
      return resolveCodebase(mention, workspaceRoot);
    case "rules":
      return {
        mention,
        content: `[Rule reference: ${mention.value}]`,
        tokenEstimate: 10,
        truncated: false,
      };
  }
}

async function resolveFile(mention: ContextMention, root: string): Promise<ResolvedMention> {
  const filePath = path.resolve(root, mention.value);
  try { assertWithinWorkspace(filePath, root); } catch {
    return { mention, content: `[Blocked: path escapes workspace]`, tokenEstimate: 10, truncated: false };
  }
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return { mention, content: `[File not found: ${mention.value}]`, tokenEstimate: 10, truncated: false };
  }
  const truncated = content.length > FILE_TRUNCATE_CHARS;
  if (truncated) {
    content = content.slice(0, FILE_TRUNCATE_CHARS) + `\n[truncated — ${content.length} chars]`;
  }
  const full = `// File: ${mention.value}\n${content}`;
  return { mention, content: full, tokenEstimate: estimateTokens(full), truncated };
}

async function resolveFolder(mention: ContextMention, root: string): Promise<ResolvedMention> {
  const dirPath = path.resolve(root, mention.value);
  try { assertWithinWorkspace(dirPath, root); } catch {
    return { mention, content: `[Blocked: path escapes workspace]`, tokenEstimate: 10, truncated: false };
  }
  const lines: string[] = [`// Folder: ${mention.value}`];
  let count = 0;

  async function listDir(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > 3 || count >= FOLDER_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= FOLDER_MAX_ENTRIES) break;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      count++;
      const isDir = entry.isDirectory();
      let sizeSuffix = "";
      if (!isDir) {
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          if (stat.size < 5120) sizeSuffix = ` (${stat.size}B)`;
        } catch { /* skip */ }
      }
      lines.push(`${prefix}${isDir ? "dir" : "file"} ${entry.name}${sizeSuffix}`);
      if (isDir) {
        await listDir(path.join(dir, entry.name), prefix + "  ", depth + 1);
      }
    }
  }

  await listDir(dirPath, "", 0);
  const truncated = count >= FOLDER_MAX_ENTRIES;
  if (truncated) lines.push(`[truncated at ${FOLDER_MAX_ENTRIES} entries]`);
  const content = lines.join("\n");
  return { mention, content, tokenEstimate: estimateTokens(content), truncated };
}

async function resolveSymbol(mention: ContextMention, root: string): Promise<ResolvedMention> {
  const allSymbols = await collectSymbols(root);
  const found = allSymbols.find((s) => s.name === mention.value);
  if (!found) {
    return { mention, content: `[Symbol not found: ${mention.value}]`, tokenEstimate: 10, truncated: false };
  }

  const filePath = path.resolve(root, found.path);
  try { assertWithinWorkspace(filePath, root); } catch {
    return { mention, content: `[Blocked: path escapes workspace]`, tokenEstimate: 10, truncated: false };
  }
  let fileContent: string;
  try {
    fileContent = await fs.readFile(filePath, "utf-8");
  } catch {
    return { mention, content: `// ${found.kind} ${found.name} in ${found.path}\n${found.preview}`, tokenEstimate: estimateTokens(found.preview), truncated: false };
  }

  const lines = fileContent.split("\n");
  const startLine = found.line - 1;
  let depth = 0;
  let endLine = startLine;
  let foundOpen = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === "{") { depth++; foundOpen = true; }
      if (ch === "}") depth--;
    }
    endLine = i;
    if (foundOpen && depth <= 0) break;
    if (!foundOpen && i > startLine && /^export\s/.test(line)) {
      endLine = i - 1;
      break;
    }
  }

  let content = lines.slice(startLine, endLine + 1).join("\n");
  const truncated = content.length > SYMBOL_TRUNCATE_CHARS;
  if (truncated) {
    content = content.slice(0, SYMBOL_TRUNCATE_CHARS) + "\n[truncated]";
  }
  const full = `// ${found.kind} ${found.name} from ${found.path}:${found.line}\n${content}`;
  return { mention, content: full, tokenEstimate: estimateTokens(full), truncated };
}

async function resolveCodebase(mention: ContextMention, root: string): Promise<ResolvedMention> {
  const searchResult = await grepSearch({
    query: mention.value,
    workspaceRoot: root,
    maxResults: CODEBASE_MAX_RESULTS,
    caseSensitive: false,
  });

  if (searchResult.results.length === 0) {
    return { mention, content: `[No codebase results for: ${mention.value}]`, tokenEstimate: 15, truncated: false };
  }

  const sections = searchResult.results.map((r) => {
    const ctx = [
      ...r.contextBefore.map((l) => `  ${l}`),
      `> ${r.content}`,
      ...r.contextAfter.map((l) => `  ${l}`),
    ].join("\n");
    const full = `// ${r.path}:${r.line}\n${ctx}`;
    return full.length > CODEBASE_RESULT_MAX_CHARS
      ? full.slice(0, CODEBASE_RESULT_MAX_CHARS) + "\n[truncated]"
      : full;
  });

  const content = `// Codebase search: ${mention.value}\n${sections.join("\n\n")}`;
  return {
    mention,
    content,
    tokenEstimate: estimateTokens(content),
    truncated: searchResult.truncated,
  };
}
