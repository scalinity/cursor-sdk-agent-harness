/**
 * Server-side settings keys (R17-S5). A neutral leaf module so both the
 * routes layer and the SDK runtime can reference the same key string without
 * a routes→sdk import. Values are persisted in the `settings` table.
 */

/** Active workspace id; persisted under this key, read at run creation. */
export const ACTIVE_WORKSPACE_SETTING_KEY = "app.activeWorkspaceId";
