import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { MAX_IMAGE_ATTACHMENTS, MAX_IMAGE_DATA_BYTES, type SdkImage } from "@harness/shared";

export { MAX_IMAGE_ATTACHMENTS } from "@harness/shared";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const PATH_PREFIX = /^(\/|\.\/|\.\.\/|~\/|[A-Za-z]:[\\/]|\\\\)/;
const RELATIVE_IMAGE_PATH = /^[^\s'"]+\.(?:png|jpe?g|webp|gif)$/i;
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";
const INK_BRACKETED_PASTE_START = "[200~";
const INK_BRACKETED_PASTE_END = "201~";
/** Base64 expands ~4/3; reject raw files above this before reading into memory. */
const MAX_RAW_IMAGE_BYTES = Math.floor((MAX_IMAGE_DATA_BYTES * 3) / 4) + 4096;

const MIME_BY_EXT: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface ImageAttachment {
  id: string;
  name: string;
  image: SdkImage;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  return `img-${counter}-${Date.now().toString(36)}`;
}

export function unwrapQuotedPath(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === "\"" && last === "\"")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function unwrapAnsiCQuotedPath(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^\$'([\s\S]*)'$/);
  if (!match) return trimmed;
  return match[1]!
    .replace(/\\'/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

export function stripBracketedPaste(input: string): string {
  if (input.startsWith(BRACKETED_PASTE_START) && input.endsWith(BRACKETED_PASTE_END)) {
    return input.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length);
  }
  if (input.startsWith(INK_BRACKETED_PASTE_START)) {
    const body = input.slice(INK_BRACKETED_PASTE_START.length);
    if (body.endsWith(BRACKETED_PASTE_END)) return body.slice(0, -BRACKETED_PASTE_END.length);
    if (body.endsWith(INK_BRACKETED_PASTE_END)) return body.slice(0, -INK_BRACKETED_PASTE_END.length);
  }
  return input;
}

function stripControlChars(text: string): string {
  let clean = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) continue;
    clean += char;
  }
  return clean;
}

export function normalizeDroppedPath(raw: string): string {
  let filePath = stripControlChars(raw).trim();
  filePath = stripBracketedPaste(filePath).trim();
  filePath = unwrapAnsiCQuotedPath(filePath);
  filePath = unwrapQuotedPath(filePath);

  if (/^file:\/\//i.test(filePath)) {
    try {
      filePath = fileURLToPath(filePath);
    } catch {
      filePath = decodeURI(filePath.replace(/^file:\/\//i, ""));
    }
  }

  filePath = filePath.replace(/\\ /g, " ");
  filePath = filePath.replace(/\\(['"])/g, "$1");

  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // Keep the raw path when it is not URI-encoded.
  }

  if (process.platform === "darwin") {
    filePath = filePath.normalize("NFC");
  }

  return filePath;
}

function splitSpaceSeparatedImagePaths(text: string): string[] {
  const matches = [...text.matchAll(/(?:^|\s)((?:file:\/\/\/|\/|~\/)(?:[^\s'\\]|\\.)+\.(?:png|jpe?g|webp|gif))\b/gi)];
  if (matches.length > 1) {
    return matches.map((match) => normalizeDroppedPath(match[1] ?? ""));
  }
  return [normalizeDroppedPath(text)];
}

function splitDroppedPathSegments(content: string): string[] {
  const normalized = stripBracketedPaste(content);
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length === 1) return splitSpaceSeparatedImagePaths(lines[0] ?? "");
  return lines.flatMap((line) => splitSpaceSeparatedImagePaths(line));
}

export function isImagePath(filePath: string): boolean {
  const normalized = normalizeDroppedPath(filePath);
  return IMAGE_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

export function looksLikeFilesystemPath(text: string): boolean {
  const normalized = normalizeDroppedPath(text);
  if (/^file:\/\//i.test(text.trim())) return true;
  if (PATH_PREFIX.test(normalized)) return true;
  return RELATIVE_IMAGE_PATH.test(normalized);
}

export function isBracketedPaste(input: string): boolean {
  return input.startsWith(BRACKETED_PASTE_START) || input.startsWith(INK_BRACKETED_PASTE_START);
}

export function resolveAttachmentPath(filePath: string): string {
  return path.resolve(expandHome(normalizeDroppedPath(filePath)));
}

export function shouldTreatAsImageDrop(input: string, paths: readonly string[]): boolean {
  if (paths.length === 0) return false;
  if (paths.length > 1) return true;
  if (isBracketedPaste(input)) return true;
  const resolved = resolveAttachmentPath(paths[0] ?? "");
  try {
    return existsSync(resolved);
  } catch {
    return false;
  }
}

/**
 * When a terminal receives a dragged image file it usually pastes one or more
 * absolute paths (optionally quoted, shell-escaped, URI-encoded, or wrapped in
 * bracketed paste). Returns the paths when the whole chunk looks like that —
 * not arbitrary pasted text.
 */
export function extractImageDropPaths(input: string): string[] | null {
  if (input.length <= 1) return null;

  const segments = splitDroppedPathSegments(input);
  if (segments.length === 0) return null;
  if (!segments.every((segment) => looksLikeFilesystemPath(segment) && isImagePath(segment))) {
    return null;
  }
  return segments;
}

export function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) {
    const home = os.homedir();
    if (home.length > 0) return path.join(home, filePath.slice(2));
  }
  return filePath;
}

async function statExistingFile(resolved: string) {
  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${resolved}`);
    }
    return fileStat;
  } catch (error) {
    if (process.platform !== "darwin" || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const nfd = resolved.normalize("NFD");
    if (nfd === resolved) throw error;
    const fileStat = await stat(nfd);
    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${nfd}`);
    }
    return fileStat;
  }
}

async function readExistingFile(resolved: string): Promise<{ bytes: Buffer; resolvedPath: string }> {
  try {
    return { bytes: await readFile(resolved), resolvedPath: resolved };
  } catch (error) {
    if (process.platform !== "darwin" || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const nfd = resolved.normalize("NFD");
    if (nfd === resolved) throw error;
    return { bytes: await readFile(nfd), resolvedPath: nfd };
  }
}

export async function readImageFromPath(filePath: string): Promise<ImageAttachment> {
  const resolved = resolveAttachmentPath(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    throw new Error(`Unsupported image type: ${ext || "(no extension)"}`);
  }

  const fileStat = await statExistingFile(resolved);
  if (fileStat.size === 0) {
    throw new Error(`Image is empty (${resolved})`);
  }
  if (fileStat.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error(`Image too large (${resolved})`);
  }

  const { bytes, resolvedPath } = await readExistingFile(resolved);
  if (bytes.length === 0) {
    throw new Error(`Image is empty (${resolvedPath})`);
  }
  const data = bytes.toString("base64");
  if (data.length === 0 || data.length > MAX_IMAGE_DATA_BYTES) {
    throw new Error(`Image too large (${resolvedPath})`);
  }

  return {
    id: nextId(),
    name: path.basename(resolvedPath),
    image: { data, mimeType },
  };
}

export function attachmentImages(attachments: ReadonlyArray<ImageAttachment>): SdkImage[] {
  return attachments.map((attachment) => attachment.image);
}

export function mergeImageAttachments(
  current: ReadonlyArray<ImageAttachment>,
  incoming: ReadonlyArray<ImageAttachment>,
): ImageAttachment[] {
  const merged = [...current, ...incoming];
  if (merged.length <= MAX_IMAGE_ATTACHMENTS) return merged;
  return merged.slice(0, MAX_IMAGE_ATTACHMENTS);
}

export function formatImageDropFailure(results: PromiseSettledResult<ImageAttachment>[]): string {
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected.length === 0) return "Could not attach dropped image.";
  const details = rejected.map((result) => (
    result.reason instanceof Error ? result.reason.message : String(result.reason)
  ));
  if (rejected.length === 1) return `Could not attach dropped image: ${details[0]}`;
  return `Could not attach ${rejected.length} dropped images: ${details.join("; ")}`;
}

export function formatImageChipLabel(name: string, maxLength = 20): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, Math.max(1, maxLength - 1))}…`;
}
