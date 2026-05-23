import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";

export type WorkspaceDecision =
  | {
      allowed: true;
      matchedEntryId: string;
      normalizedPath: string;
    }
  | {
      allowed: false;
      normalizedPath: string;
      reason: "not_allowlisted" | "missing" | "symlink_escape";
    };

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

export interface WorkspacePolicyOptions {
  allowlist: WorkspaceAllowlistRepo;
}

export class WorkspacePolicy {
  constructor(private readonly opts: WorkspacePolicyOptions) {}

  /**
   * Resolve `candidatePath` against the workspace allowlist.
   *
   * Algorithm (spec §10):
   * 1. `path.normalize` → string form used in the decision payload.
   * 2. `fs.realpath` to canonicalize the candidate. ENOENT → `missing`.
   * 3. Symlink-escape detection: if the realpath differs from the normalized
   *    candidate, the realpath must still live underneath the apparent parent
   *    directory's realpath. Otherwise the symlink redirected the candidate
   *    out of its apparent scope and we refuse to trust the allowlist match.
   * 4. Match the realpath against allowlist rows. Exact match wins; otherwise
   *    a recursive ancestor wins. Anything else is `not_allowlisted`.
   *
   * `last_used_at` is intentionally NOT updated here. The caller (REST route,
   * agent creator) updates it after a successful action so we don't bump it
   * on every validation probe.
   */
  async check(candidatePath: string): Promise<WorkspaceDecision> {
    const normalized = path.normalize(candidatePath);

    let realPath: string;
    try {
      realPath = await fs.realpath(normalized);
    } catch (err) {
      if (isENOENT(err)) {
        return { allowed: false, normalizedPath: normalized, reason: "missing" };
      }
      throw err;
    }

    if (realPath !== normalized) {
      const apparentParent = path.dirname(normalized);
      let parentReal: string;
      try {
        parentReal = await fs.realpath(apparentParent);
      } catch {
        parentReal = apparentParent;
      }
      // `isInside` already returns true when child === parent, so a single
      // negative check covers both "escaped" and "is the parent itself".
      if (!isInside(realPath, parentReal)) {
        return {
          allowed: false,
          normalizedPath: normalized,
          reason: "symlink_escape",
        };
      }
    }

    const match = this.opts.allowlist.findMatching(realPath);
    if (!match) {
      return { allowed: false, normalizedPath: realPath, reason: "not_allowlisted" };
    }
    return {
      allowed: true,
      matchedEntryId: match.id,
      normalizedPath: realPath,
    };
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}
