import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { WorkspaceIndexer } from "./indexer.js";
import { DEFAULT_INDEXED_EXTENSIONS, SKIP_DIRS } from "./file-walker.js";

/**
 * Phase 23 — incremental re-index on file changes.
 *
 * One recursive fs.watch per active workspace, debounced 2s per path. Only
 * indexable extensions are acted on. Recursive watch is supported on macOS
 * (the harness's primary target) and Windows; on platforms without it the
 * watcher fails to arm and indexing falls back to manual / startup re-index.
 */

const DEBOUNCE_MS = 2000;
const INDEXED_EXTS = new Set<string>(DEFAULT_INDEXED_EXTENSIONS);

export interface WorkspaceWatcherDeps {
  indexer: WorkspaceIndexer;
  logger: FastifyBaseLogger;
}

export class WorkspaceWatcher {
  private watcher: fs.FSWatcher | null = null;
  private workspaceId: string | null = null;
  private root: string | null = null;
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: WorkspaceWatcherDeps) {}

  /** (Re)arm the watcher on a workspace root. No-op if already on this root. */
  start(workspaceId: string, root: string): void {
    if (this.workspaceId === workspaceId && this.watcher) return;
    this.stop();
    this.workspaceId = workspaceId;
    this.root = root;
    try {
      this.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (filename) this.onChange(filename.toString());
      });
      this.watcher.on("error", (err) => {
        this.deps.logger.warn({ err, root }, "file-watcher error; disarming");
        this.stop();
      });
    } catch (err) {
      this.deps.logger.warn({ err, root }, "file-watcher: recursive watch unavailable");
      this.watcher = null;
    }
  }

  /** Stop only if currently watching this workspace (P23-C1 purge). */
  stopIfWatching(workspaceId: string): void {
    if (this.workspaceId === workspaceId) this.stop();
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.workspaceId = null;
    this.root = null;
  }

  private onChange(relName: string): void {
    const ext = path.extname(relName).toLowerCase();
    if (!INDEXED_EXTS.has(ext)) return;
    // P23 (DB1 suggestion): mirror the walker's skip-dirs so a change under
    // node_modules/dist/etc never gets indexed (the full walk would never
    // include it — keeps the watcher-maintained set consistent with walkWorkspace).
    if (relName.split(path.sep).some((seg) => SKIP_DIRS.has(seg) || seg.startsWith("."))) {
      return;
    }
    const existing = this.pending.get(relName);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(relName);
      void this.flush(relName);
    }, DEBOUNCE_MS);
    if (typeof timer.unref === "function") timer.unref();
    this.pending.set(relName, timer);
  }

  private async flush(relName: string): Promise<void> {
    const workspaceId = this.workspaceId;
    const root = this.root;
    if (!workspaceId || !root) return;
    const abs = path.join(root, relName);
    try {
      await fsp.stat(abs);
      await this.deps.indexer.reindexFile(workspaceId, relName, abs);
    } catch {
      // Stat failed → file removed/renamed away → drop its chunks.
      this.deps.indexer.removeFile(workspaceId, relName);
    }
  }
}
