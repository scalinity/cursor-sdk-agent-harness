-- Phase 22: Enrichment — Docs Indexing, Notepads, Terminal AI, Slash Commands

-- Documentation sources
CREATE TABLE IF NOT EXISTS docs_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'crawling', 'indexed', 'error')),
  page_count INTEGER NOT NULL DEFAULT 0,
  last_crawled_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Crawled documentation pages
CREATE TABLE IF NOT EXISTS docs_pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES docs_sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  crawled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 index for documentation search
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  page_id UNINDEXED,
  source_id UNINDEXED,
  title,
  content,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS docs_fts_insert AFTER INSERT ON docs_pages BEGIN
  INSERT INTO docs_fts(page_id, source_id, title, content)
  VALUES (NEW.id, NEW.source_id, NEW.title, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS docs_fts_delete AFTER DELETE ON docs_pages BEGIN
  DELETE FROM docs_fts WHERE page_id = OLD.id;
END;

-- Notepads (persistent context documents)
CREATE TABLE IF NOT EXISTS notepads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Slash commands
CREATE TABLE IF NOT EXISTS slash_commands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  template TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
