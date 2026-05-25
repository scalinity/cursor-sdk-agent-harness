import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { Notepad, NotepadSummary } from "@harness/shared";
import { isoNow } from "./mapping.js";

interface NotepadDbRow {
  id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: NotepadDbRow): Notepad {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: NotepadDbRow): NotepadSummary {
  return {
    id: row.id,
    name: row.name,
    contentLength: row.content.length,
    updatedAt: row.updated_at,
  };
}

export class NotepadsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  list(): NotepadSummary[] {
    const rows = this.raw
      .prepare("SELECT * FROM notepads ORDER BY updated_at DESC")
      .all() as NotepadDbRow[];
    return rows.map(rowToSummary);
  }

  getById(id: string): Notepad | undefined {
    const row = this.raw
      .prepare("SELECT * FROM notepads WHERE id = ?")
      .get(id) as NotepadDbRow | undefined;
    return row ? rowToDomain(row) : undefined;
  }

  getByName(name: string): Notepad | undefined {
    const row = this.raw
      .prepare("SELECT * FROM notepads WHERE name = ?")
      .get(name) as NotepadDbRow | undefined;
    return row ? rowToDomain(row) : undefined;
  }

  create(id: string, name: string, content: string): Notepad {
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO notepads (id, name, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, name, content, now, now);
    return { id, name, content, createdAt: now, updatedAt: now };
  }

  updateContent(id: string, content: string): boolean {
    const result = this.raw
      .prepare("UPDATE notepads SET content = ?, updated_at = ? WHERE id = ?")
      .run(content, isoNow(), id);
    return result.changes > 0;
  }

  rename(id: string, name: string): boolean {
    const result = this.raw
      .prepare("UPDATE notepads SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, isoNow(), id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.raw
      .prepare("DELETE FROM notepads WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }
}
