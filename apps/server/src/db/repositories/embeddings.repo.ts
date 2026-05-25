import { randomUUID } from "node:crypto";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

/**
 * Phase 23 — chunk embedding store.
 *
 * `content_hash` holds the SHA-256 of the *whole file* (the same value on
 * every chunk of that file) so incremental indexing can skip a file whose
 * content is unchanged with a single distinct lookup.
 */

export interface EmbeddingInsert {
  workspaceId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string | null;
  content: string;
  embedding: Buffer;
  contentHash: string;
}

export interface IndexedFileRef {
  filePath: string;
  contentHash: string;
}

export interface EmbeddingSearchRow {
  filePath: string;
  startLine: number;
  endLine: number;
  language: string | null;
  content: string;
  embedding: Buffer;
}

interface EmbeddingDbRow {
  file_path: string;
  start_line: number;
  end_line: number;
  language: string | null;
  content: string;
  embedding: Buffer;
}

export class EmbeddingsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  /** Distinct (file_path, content_hash) — one row per indexed file. */
  listIndexedFiles(workspaceId: string): IndexedFileRef[] {
    const rows = this.raw
      .prepare(
        "SELECT DISTINCT file_path, content_hash FROM embeddings WHERE workspace_id = ?",
      )
      .all(workspaceId) as Array<{ file_path: string; content_hash: string }>;
    return rows.map((r) => ({ filePath: r.file_path, contentHash: r.content_hash }));
  }

  countByWorkspace(workspaceId: string): number {
    const row = this.raw
      .prepare("SELECT COUNT(*) AS n FROM embeddings WHERE workspace_id = ?")
      .get(workspaceId) as { n: number };
    return row.n;
  }

  /** Replace all chunks for a single file in one transaction. */
  replaceFile(workspaceId: string, filePath: string, chunks: EmbeddingInsert[]): void {
    const del = this.raw.prepare(
      "DELETE FROM embeddings WHERE workspace_id = ? AND file_path = ?",
    );
    const ins = this.raw.prepare(
      `INSERT INTO embeddings
         (id, workspace_id, file_path, start_line, end_line, language, content, embedding, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.raw.transaction((rows: EmbeddingInsert[]) => {
      del.run(workspaceId, filePath);
      for (const c of rows) {
        ins.run(
          randomUUID(),
          c.workspaceId,
          c.filePath,
          c.startLine,
          c.endLine,
          c.language,
          c.content,
          c.embedding,
          c.contentHash,
        );
      }
    });
    tx(chunks);
  }

  deleteFile(workspaceId: string, filePath: string): void {
    this.raw
      .prepare("DELETE FROM embeddings WHERE workspace_id = ? AND file_path = ?")
      .run(workspaceId, filePath);
  }

  deleteWorkspace(workspaceId: string): void {
    this.raw.prepare("DELETE FROM embeddings WHERE workspace_id = ?").run(workspaceId);
  }

  /** All chunk rows for a workspace (brute-force cosine happens in JS). */
  searchRows(workspaceId: string): EmbeddingSearchRow[] {
    const rows = this.raw
      .prepare(
        `SELECT file_path, start_line, end_line, language, content, embedding
         FROM embeddings WHERE workspace_id = ?`,
      )
      .all(workspaceId) as EmbeddingDbRow[];
    return rows.map((r) => ({
      filePath: r.file_path,
      startLine: r.start_line,
      endLine: r.end_line,
      language: r.language,
      content: r.content,
      embedding: r.embedding,
    }));
  }
}
