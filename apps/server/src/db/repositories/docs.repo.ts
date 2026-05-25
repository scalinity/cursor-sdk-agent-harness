import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { DocsSource, DocsSourceStatus } from "@harness/shared";
import { isoNow } from "./mapping.js";

interface DocsSourceDbRow {
  id: string;
  name: string;
  base_url: string;
  status: string;
  page_count: number;
  max_pages: number;
  last_crawled_at: string | null;
  error_message: string | null;
  created_at: string;
}

interface FtsRow {
  page_id: string;
  source_id: string;
  title: string;
  snippet: string;
  rank: number;
}

function rowToSource(row: DocsSourceDbRow): DocsSource {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    status: row.status as DocsSourceStatus,
    pageCount: row.page_count,
    maxPages: row.max_pages,
    lastCrawledAt: row.last_crawled_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export class DocsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  listSources(): DocsSource[] {
    const rows = this.raw
      .prepare("SELECT * FROM docs_sources ORDER BY created_at DESC")
      .all() as DocsSourceDbRow[];
    return rows.map(rowToSource);
  }

  getSource(id: string): DocsSource | undefined {
    const row = this.raw
      .prepare("SELECT * FROM docs_sources WHERE id = ?")
      .get(id) as DocsSourceDbRow | undefined;
    return row ? rowToSource(row) : undefined;
  }

  insertSource(id: string, name: string, baseUrl: string, maxPages: number): DocsSource {
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO docs_sources (id, name, base_url, status, page_count, max_pages, created_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(id, name, baseUrl, maxPages, now);
    return {
      id,
      name,
      baseUrl,
      status: "pending",
      pageCount: 0,
      maxPages,
      lastCrawledAt: null,
      errorMessage: null,
      createdAt: now,
    };
  }

  updateSourceStatus(
    id: string,
    status: DocsSourceStatus,
    errorMessage?: string | null,
  ): void {
    this.raw
      .prepare(
        `UPDATE docs_sources
         SET status = ?, error_message = ?, last_crawled_at = ?
         WHERE id = ?`,
      )
      .run(status, errorMessage ?? null, isoNow(), id);
  }

  updateSourcePageCount(id: string, count: number): void {
    this.raw
      .prepare("UPDATE docs_sources SET page_count = ? WHERE id = ?")
      .run(count, id);
  }

  deleteSource(id: string): boolean {
    const result = this.raw
      .prepare("DELETE FROM docs_sources WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  insertPage(
    id: string,
    sourceId: string,
    url: string,
    title: string,
    content: string,
  ): void {
    this.raw
      .prepare(
        `INSERT INTO docs_pages (id, source_id, url, title, content, crawled_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sourceId, url, title, content, isoNow());
  }

  deletePagesBySource(sourceId: string): number {
    const result = this.raw
      .prepare("DELETE FROM docs_pages WHERE source_id = ?")
      .run(sourceId);
    return result.changes;
  }

  search(
    query: string,
    maxResults: number,
    sourceId?: string,
  ): Array<{
    sourceId: string;
    sourceName: string;
    url: string;
    title: string;
    snippet: string;
    rank: number;
  }> {
    const baseQuery = `
      SELECT
        f.page_id,
        f.source_id,
        f.title,
        snippet(docs_fts, 3, '<mark>', '</mark>', '...', 40) AS snippet,
        rank
      FROM docs_fts f
      WHERE docs_fts MATCH ?
      ${sourceId ? "AND f.source_id = ?" : ""}
      ORDER BY rank
      LIMIT ?
    `;

    // Wrap in double quotes and escape internal quotes so user-supplied
    // characters like *, OR, NEAR, -, :, ., ( don't trip FTS5 syntax errors.
    // Mirrors the sanitization in runs.repo.ts search().
    const safeQuery = '"' + query.replace(/"/g, '""') + '"';

    const params: unknown[] = [safeQuery];
    if (sourceId) params.push(sourceId);
    params.push(maxResults);

    const ftsRows = this.raw.prepare(baseQuery).all(...params) as FtsRow[];

    const sourceNames = new Map<string, string>();
    for (const row of ftsRows) {
      if (!sourceNames.has(row.source_id)) {
        const src = this.getSource(row.source_id);
        sourceNames.set(row.source_id, src?.name ?? "Unknown");
      }
    }

    const pageUrls = new Map<string, string>();
    for (const row of ftsRows) {
      if (!pageUrls.has(row.page_id)) {
        const page = this.raw
          .prepare("SELECT url FROM docs_pages WHERE id = ?")
          .get(row.page_id) as { url: string } | undefined;
        pageUrls.set(row.page_id, page?.url ?? "");
      }
    }

    return ftsRows.map((row, i) => ({
      sourceId: row.source_id,
      sourceName: sourceNames.get(row.source_id) ?? "Unknown",
      url: pageUrls.get(row.page_id) ?? "",
      title: row.title,
      snippet: row.snippet,
      rank: i + 1,
    }));
  }
}
