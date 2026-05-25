/**
 * Read-only workspace file browser service.
 *
 * Lists directories and reads file contents for the Files surface. Every
 * candidate path is normalized, resolved against the workspace root, and
 * realpath-checked so neither `..` traversal nor a symlink can escape the
 * workspace boundary — the same perimeter the file-write route enforces
 * (spec §10). Nothing here mutates the filesystem.
 */
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";

/** Max bytes read for a read-only preview. Larger files come back truncated. */
export const MAX_PREVIEW_BYTES = 512 * 1024; // 512 KiB
/** Bytes scanned at the head of a file for a NUL byte (binary heuristic). */
const BINARY_SNIFF_BYTES = 8192;

export type WorkspaceFilesErrorCode =
  | "ABSOLUTE_PATH_REJECTED"
  | "PATH_TRAVERSAL_REJECTED"
  | "WORKSPACE_NOT_FOUND"
  | "NOT_FOUND"
  | "NOT_A_DIRECTORY"
  | "NOT_A_FILE";

export interface WorkspaceFileEntryOut {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string | null;
}

export interface DirListing {
  relPath: string;
  parent: string | null;
  entries: WorkspaceFileEntryOut[];
}

export interface FileContent {
  relPath: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; code: WorkspaceFilesErrorCode };

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

interface ResolvedTarget {
  absPath: string;
  realRoot: string;
}

/**
 * Resolve `relPath` to an absolute path guaranteed to live inside the
 * workspace root, or return a typed error. Rejects absolute inputs, `..`
 * traversal, and symlinks whose realpath escapes the root.
 */
async function resolveInsideWorkspace(
  workspaceRoot: string,
  relPath: string,
): Promise<Result<ResolvedTarget>> {
  if (path.isAbsolute(relPath)) {
    return { ok: false, code: "ABSOLUTE_PATH_REJECTED" };
  }

  let realRoot: string;
  try {
    realRoot = await fs.realpath(workspaceRoot);
  } catch (err) {
    if (isENOENT(err)) return { ok: false, code: "WORKSPACE_NOT_FOUND" };
    throw err;
  }

  // String-level traversal check against the normalized candidate.
  const target = path.normalize(path.resolve(realRoot, relPath));
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) {
    return { ok: false, code: "PATH_TRAVERSAL_REJECTED" };
  }

  // Canonicalize to defeat symlinks that redirect outside the root.
  let realTarget: string;
  try {
    realTarget = await fs.realpath(target);
  } catch (err) {
    if (isENOENT(err)) return { ok: false, code: "NOT_FOUND" };
    throw err;
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    return { ok: false, code: "PATH_TRAVERSAL_REJECTED" };
  }

  return { ok: true, value: { absPath: realTarget, realRoot } };
}

function relParent(relPath: string): string | null {
  if (relPath === "" || relPath === ".") return null;
  const parent = path.dirname(relPath);
  return parent === "." ? "" : parent;
}

function classify(entry: Dirent): WorkspaceFileEntryOut["type"] {
  // Symlinks are reported as their own type (not followed for classification),
  // so the client never treats a link-to-directory as a navigable folder.
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

export async function listWorkspaceFiles(
  workspaceRoot: string,
  relPath: string,
): Promise<Result<DirListing>> {
  const resolved = await resolveInsideWorkspace(workspaceRoot, relPath);
  if (!resolved.ok) return resolved;
  const { absPath } = resolved.value;

  const stat = await fs.stat(absPath);
  if (!stat.isDirectory()) return { ok: false, code: "NOT_A_DIRECTORY" };

  const dirents = await fs.readdir(absPath, { withFileTypes: true });
  const entries: WorkspaceFileEntryOut[] = [];
  for (const dirent of dirents) {
    const type = classify(dirent);
    let size = 0;
    let modifiedAt: string | null = null;
    try {
      const st = await fs.stat(path.join(absPath, dirent.name));
      size = st.isFile() ? st.size : 0;
      modifiedAt = st.mtime.toISOString();
    } catch {
      // Unreadable entry (permissions / broken symlink) — list it without
      // metadata rather than failing the whole directory.
    }
    entries.push({ name: dirent.name, type, size, modifiedAt });
  }

  // Directories first, then files; alphabetical, case-insensitive per group.
  entries.sort((a, b) => {
    const aDir = a.type === "directory" ? 0 : 1;
    const bDir = b.type === "directory" ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const normalizedRel = relPath === "." ? "" : relPath;
  return {
    ok: true,
    value: { relPath: normalizedRel, parent: relParent(normalizedRel), entries },
  };
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
): Promise<Result<FileContent>> {
  const resolved = await resolveInsideWorkspace(workspaceRoot, relPath);
  if (!resolved.ok) return resolved;
  const { absPath } = resolved.value;

  const stat = await fs.stat(absPath);
  if (!stat.isFile()) return { ok: false, code: "NOT_A_FILE" };

  const handle = await fs.open(absPath, "r");
  try {
    const readLen = Math.min(stat.size, MAX_PREVIEW_BYTES);
    const buf = Buffer.alloc(readLen);
    if (readLen > 0) await handle.read(buf, 0, readLen, 0);
    const sniff = buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES));
    const binary = sniff.includes(0);
    return {
      ok: true,
      value: {
        relPath,
        content: binary ? "" : buf.toString("utf-8"),
        size: stat.size,
        truncated: stat.size > readLen,
        binary,
      },
    };
  } finally {
    await handle.close();
  }
}
