import { promises as fs } from "node:fs";
import os from "node:os";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "../config/settings-keys.js";

export interface EnsureDefaultWorkspaceDeps {
  allowlist: WorkspaceAllowlistRepo;
  settings: SettingsRepo;
}

/**
 * Cursor-style zero-setup default. On first launch — or whenever the active
 * pointer is missing / left dangling at a deleted row — fall back to the user's
 * home directory so the coding agent auto-provisions and the model works
 * without the user picking a folder first.
 *
 * Security note: this widens the *default* allowlist to `~` (recursive), which
 * matches Cursor's "Home" default. The harness is single-user and local; the
 * home dir is realpath-resolved before it's stored, so a symlink can't redirect
 * the canonical path. A user who wants a tighter scope picks a narrower folder
 * in the workspace switcher — that choice persists and is honored over this
 * default (the early-return below never overwrites an existing valid pointer).
 *
 * Idempotent and non-fatal: a valid active workspace short-circuits to a no-op;
 * any failure (pathological home dir) is swallowed so the server still boots and
 * the renderer's WorkspaceRequiredModal remains the fallback.
 */
export async function ensureDefaultWorkspace(
  deps: EnsureDefaultWorkspaceDeps,
): Promise<void> {
  try {
    const currentId = deps.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
    if (
      typeof currentId === "string" &&
      currentId.length > 0 &&
      deps.allowlist.getById(currentId)
    ) {
      return;
    }

    const realHome = await fs.realpath(os.homedir());
    // Reuse an exact existing row; a recursive *ancestor* match (path !== home)
    // must not shadow Home, so create a dedicated row in that case — mirrors the
    // POST /api/workspace-allowlist idempotency rule.
    const existing = deps.allowlist.findMatching(realHome);
    const entry =
      existing && existing.path === realHome
        ? existing
        : deps.allowlist.create({ path: realHome, label: "Home", recursive: true });

    deps.settings.set(ACTIVE_WORKSPACE_SETTING_KEY, entry.id);
    deps.allowlist.markUsed(entry.id);
  } catch (e) {
    console.warn("[ensureDefaultWorkspace] failed to provision home directory:", e);
  }
}
