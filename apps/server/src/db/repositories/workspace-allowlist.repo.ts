import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WorkspaceAllowlistRow } from "@harness/shared";
import { boolFromInt, intFromBool, isoNow } from "./mapping.js";

export interface CreateWorkspaceAllowlistInput {
  id?: string;
  path: string;
  label?: string | null;
  recursive?: boolean;
}

interface WorkspaceAllowlistDbRow {
  id: string;
  path: string;
  label: string | null;
  recursive: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

function rowToDomain(row: WorkspaceAllowlistDbRow): WorkspaceAllowlistRow {
  return {
    id: row.id,
    path: row.path,
    label: row.label,
    recursive: boolFromInt(row.recursive),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

export class WorkspaceAllowlistRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  create(input: CreateWorkspaceAllowlistInput): WorkspaceAllowlistRow {
    const id = input.id ?? randomUUID();
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO workspace_allowlist (
            id, path, label, recursive, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.path,
        input.label ?? null,
        intFromBool(input.recursive ?? true),
        now,
        now,
      );
    const row = this.getById(id);
    if (!row) {
      throw new Error(`WorkspaceAllowlistRepo.create: row not found id=${id}`);
    }
    return row;
  }

  getById(id: string): WorkspaceAllowlistRow | null {
    const row = this.raw
      .prepare("SELECT * FROM workspace_allowlist WHERE id = ?")
      .get(id) as WorkspaceAllowlistDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  list(): WorkspaceAllowlistRow[] {
    const rows = this.raw
      .prepare("SELECT * FROM workspace_allowlist ORDER BY created_at DESC")
      .all() as WorkspaceAllowlistDbRow[];
    return rows.map(rowToDomain);
  }

  delete(id: string): void {
    this.raw.prepare("DELETE FROM workspace_allowlist WHERE id = ?").run(id);
  }

  markUsed(id: string, when: Date = new Date()): void {
    const iso = when.toISOString();
    this.raw
      .prepare(
        `UPDATE workspace_allowlist
            SET last_used_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(iso, iso, id);
  }

  /**
   * Find the allowlist row that matches `candidatePath`. The candidate is the
   * realpath-resolved string from the caller; this function only does path
   * matching. Full realpath/symlink validation lives in the Phase 05
   * workspace-policy module.
   */
  findMatching(candidatePath: string): WorkspaceAllowlistRow | null {
    const normalized = path.normalize(candidatePath);

    // Exact match wins regardless of recursive flag.
    const exact = this.raw
      .prepare("SELECT * FROM workspace_allowlist WHERE path = ?")
      .get(normalized) as WorkspaceAllowlistDbRow | undefined;
    if (exact) return rowToDomain(exact);

    // Otherwise, look for a recursive ancestor.
    const rows = this.raw
      .prepare("SELECT * FROM workspace_allowlist WHERE recursive = 1")
      .all() as WorkspaceAllowlistDbRow[];
    for (const row of rows) {
      const entryPath = path.normalize(row.path);
      const relative = path.relative(entryPath, normalized);
      const isDescendant =
        relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
      if (isDescendant) {
        return rowToDomain(row);
      }
    }
    return null;
  }
}
