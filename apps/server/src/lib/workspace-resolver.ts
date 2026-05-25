/**
 * Shared utility for resolving the active workspace path from settings.
 * Used by files.routes.ts and git.routes.ts to avoid duplicating the
 * settings-repo → workspace-allowlist lookup.
 */
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "../config/settings-keys.js";

export interface WorkspaceResolverDeps {
  settingsRepo: SettingsRepo;
  workspaceAllowlist: WorkspaceAllowlistRepo;
}

/**
 * Resolve the workspace path for a given workspaceId, falling back to the
 * active workspace from settings when no explicit id is provided.
 * Returns null when no workspace is configured or the id doesn't match.
 */
export function resolveWorkspacePath(
  deps: WorkspaceResolverDeps,
  workspaceId?: string,
): string | null {
  const id =
    workspaceId ??
    deps.settingsRepo.get<string>(ACTIVE_WORKSPACE_SETTING_KEY) ??
    null;
  if (!id) return null;
  const entry = deps.workspaceAllowlist.getById(id);
  return entry?.path ?? null;
}
