import os from "node:os";
import path from "node:path";
import { truncateMiddle } from "../repl/theme.js";

export interface NormalizePathOptions {
  /** Home directory used for the `~/…` rewrite. Defaults to `os.homedir()`. Injectable for tests. */
  home?: string;
  /** When set, the display path is middle-truncated to this width (never right-truncated). */
  maxWidth?: number;
}

/**
 * Render a path the way a human reads it:
 * - inside `cwd`           → relative (`src/index.ts`)
 * - inside `$HOME` (not cwd) → `~/…`
 * - neither                → absolute, middle-truncated if `maxWidth` is set
 *
 * Pure string transform — does NOT resolve symlinks, so the path the caller
 * invoked is rendered, not its realpath target. Inputs that are already
 * relative are returned untouched (treated as cwd-relative).
 */
export function normalizePath(targetPath: string, cwd: string, options: NormalizePathOptions = {}): string {
  const home = options.home ?? os.homedir();
  const display = toDisplayPath(targetPath, cwd, home);
  return options.maxWidth !== undefined ? truncateMiddle(display, options.maxWidth) : display;
}

function toDisplayPath(targetPath: string, cwd: string, home: string): string {
  if (!targetPath) return targetPath;
  // Already-relative input is treated as cwd-relative and left as-is.
  if (!path.isAbsolute(targetPath) && !targetPath.startsWith("~")) return targetPath;
  const abs = targetPath.startsWith("~") ? path.join(home, targetPath.slice(1)) : targetPath;
  if (isInside(cwd, abs)) {
    const rel = path.relative(cwd, abs);
    return rel === "" ? "." : rel;
  }
  if (isInside(home, abs)) {
    const rel = path.relative(home, abs);
    return rel === "" ? "~" : `~/${rel}`;
  }
  return abs;
}

function isInside(parent: string, child: string): boolean {
  if (parent === child) return true;
  const withSep = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(withSep);
}
