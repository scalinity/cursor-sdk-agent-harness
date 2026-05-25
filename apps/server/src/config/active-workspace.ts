import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "./settings-keys.js";

export function getActiveWorkspaceRoot(deps: {
  settingsRepo: SettingsRepo;
  allowlistRepo: WorkspaceAllowlistRepo;
}): string | null {
  const raw = deps.settingsRepo.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
  if (typeof raw !== "string" || raw.length === 0) return null;

  const row = deps.allowlistRepo.getById(raw);
  if (row) return row.path;

  const entry = deps.allowlistRepo.findMatching(raw);
  return entry ? raw : null;
}
