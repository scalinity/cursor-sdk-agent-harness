// Tiny .env parser used by the dev orchestrator (scripts/dev.mjs). Kept
// here as a self-contained module so it can be imported by both the
// orchestrator and the unit test without pulling in `dotenv` as a
// runtime dependency.
//
// Supported:
// - `KEY=value` lines
// - Double- and single-quoted values: KEY="value" / KEY='value'
// - Leading/trailing whitespace on key and value
// - Lines starting with `#` are comments
// - Blank lines are ignored
//
// NOT supported (intentionally — keep the parser minimal):
// - Multi-line values
// - Variable expansion (`KEY=${OTHER}`)
// - Escape sequences inside quoted values

export function parseDotEnv(raw) {
  const out = Object.create(null);
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Apply a parsed .env to process.env. Existing keys (non-empty) are
 * NEVER overwritten — matches dotenv's default behavior so callers can
 * still inject vars from the shell.
 */
export function applyDotEnvToProcess(parsed, env = process.env) {
  for (const [key, value] of Object.entries(parsed)) {
    if (key in env) continue;
    env[key] = value;
  }
}
