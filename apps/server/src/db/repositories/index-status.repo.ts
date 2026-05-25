import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { isoNow } from "./mapping.js";

/**
 * Phase 23 — per-workspace indexing status. Single row per workspace,
 * keyed by the workspace path (the harness's workspace identifier).
 */

export interface IndexStatusRow {
  workspaceId: string;
  status: string;
  totalFiles: number;
  indexedFiles: number;
  totalChunks: number;
  lastIndexedAt: string | null;
  errorMessage: string | null;
}

interface IndexStatusDbRow {
  workspace_id: string;
  status: string;
  total_files: number;
  indexed_files: number;
  total_chunks: number;
  last_indexed_at: string | null;
  error_message: string | null;
}

function rowToDomain(row: IndexStatusDbRow): IndexStatusRow {
  return {
    workspaceId: row.workspace_id,
    status: row.status,
    totalFiles: row.total_files,
    indexedFiles: row.indexed_files,
    totalChunks: row.total_chunks,
    lastIndexedAt: row.last_indexed_at,
    errorMessage: row.error_message,
  };
}

export class IndexStatusRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  get(workspaceId: string): IndexStatusRow | null {
    const row = this.raw
      .prepare("SELECT * FROM index_status WHERE workspace_id = ?")
      .get(workspaceId) as IndexStatusDbRow | undefined;
    return row ? rowToDomain(row) : null;
  }

  setIndexing(workspaceId: string, totalFiles: number): void {
    this.raw
      .prepare(
        `INSERT INTO index_status (workspace_id, status, total_files, indexed_files, total_chunks, error_message)
         VALUES (?, 'indexing', ?, 0, 0, NULL)
         ON CONFLICT(workspace_id) DO UPDATE SET
           status = 'indexing', total_files = excluded.total_files,
           indexed_files = 0, total_chunks = 0, error_message = NULL`,
      )
      .run(workspaceId, totalFiles);
  }

  setProgress(workspaceId: string, indexedFiles: number, totalChunks: number): void {
    this.raw
      .prepare(
        "UPDATE index_status SET indexed_files = ?, total_chunks = ? WHERE workspace_id = ?",
      )
      .run(indexedFiles, totalChunks, workspaceId);
  }

  setIndexed(
    workspaceId: string,
    totalFiles: number,
    indexedFiles: number,
    totalChunks: number,
  ): void {
    this.raw
      .prepare(
        `INSERT INTO index_status (workspace_id, status, total_files, indexed_files, total_chunks, last_indexed_at, error_message)
         VALUES (?, 'indexed', ?, ?, ?, ?, NULL)
         ON CONFLICT(workspace_id) DO UPDATE SET
           status = 'indexed', total_files = excluded.total_files,
           indexed_files = excluded.indexed_files, total_chunks = excluded.total_chunks,
           last_indexed_at = excluded.last_indexed_at, error_message = NULL`,
      )
      .run(workspaceId, totalFiles, indexedFiles, totalChunks, isoNow());
  }

  setError(workspaceId: string, message: string): void {
    this.raw
      .prepare(
        `INSERT INTO index_status (workspace_id, status, error_message)
         VALUES (?, 'error', ?)
         ON CONFLICT(workspace_id) DO UPDATE SET status = 'error', error_message = excluded.error_message`,
      )
      .run(workspaceId, message);
  }

  setStale(workspaceId: string): void {
    this.raw
      .prepare(
        "UPDATE index_status SET status = 'stale' WHERE workspace_id = ? AND status = 'indexed'",
      )
      .run(workspaceId);
  }

  /** P23-C1: drop the status row when a workspace is removed. */
  delete(workspaceId: string): void {
    this.raw.prepare("DELETE FROM index_status WHERE workspace_id = ?").run(workspaceId);
  }
}
