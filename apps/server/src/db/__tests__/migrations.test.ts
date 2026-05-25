import { describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { DEFAULT_SETTING_KEYS } from "../seed.js";

describe("migrations + verifyMigrations", () => {
  it("applies the full schema to a fresh in-memory database", () => {
    const client = openTestDb({ skipSeed: true });

    const tables = client.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_harness_migrations' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "agents",
      "docs_fts",
      "docs_fts_config",
      "docs_fts_content",
      "docs_fts_data",
      "docs_fts_docsize",
      "docs_fts_idx",
      "docs_pages",
      "docs_sources",
      "embeddings",
      "events",
      "index_status",
      "mcp_servers",
      "model_providers",
      "notepads",
      "runs",
      "runs_fts",
      "runs_fts_config",
      "runs_fts_content",
      "runs_fts_data",
      "runs_fts_docsize",
      "runs_fts_idx",
      "settings",
      "slash_commands",
      "subagent_definitions",
      "workspace_allowlist",
    ]);

    client.close();
  });

  it("is idempotent — re-running verifyMigrations applies zero migrations", () => {
    const client = openTestDb({ skipSeed: true });
    const second = client.verifyMigrations();
    expect(second.applied).toBe(0);
    expect(second.seeded).toBe(false);
    client.close();
  });

  it("seeds default settings on first verifyMigrations call only", () => {
    const client = openTestDb();
    const keys = client.raw
      .prepare("SELECT key FROM settings ORDER BY key")
      .all()
      .map((row) => (row as { key: string }).key);

    for (const expectedKey of DEFAULT_SETTING_KEYS) {
      expect(keys).toContain(expectedKey);
    }

    const promo = client.raw
      .prepare("SELECT value_json FROM settings WHERE key = 'pricing.promo_multiplier'")
      .get() as { value_json: string };
    expect(JSON.parse(promo.value_json)).toBeCloseTo(1.0);

    // Second call does not re-seed even though the row count is non-zero.
    const second = client.verifyMigrations();
    expect(second.seeded).toBe(false);
    client.close();
  });

  it("enforces foreign_keys = ON", () => {
    const client = openTestDb({ skipSeed: true });
    const result = client.raw.pragma("foreign_keys", { simple: true });
    expect(result).toBe(1);
    client.close();
  });
});
