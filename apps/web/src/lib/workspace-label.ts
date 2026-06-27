import type { WorkspaceAllowlistRow } from "@harness/shared";

/**
 * Display name for a workspace: its explicit label (e.g. the seeded "Home")
 * when set, otherwise the basename of its path. Shared by the sessions rail
 * group headers and the workspace switcher so both render identically.
 */
export function workspaceLabel(ws: WorkspaceAllowlistRow): string {
  if (ws.label && ws.label.length > 0) return ws.label;
  const segments = ws.path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? ws.path;
}
