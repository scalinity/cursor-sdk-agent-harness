import { describe, it, expect } from "vitest";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { PRICING_SETTING_KEYS } from "@harness/shared";
import { openDb } from "../client.js";
import {
  backfillPricingDefaultsIfUnconfigured,
  seedDefaultSettingsIfEmpty,
} from "../seed.js";

function readSetting(raw: BetterSqlite3Database, key: string): unknown {
  const row = raw
    .prepare("SELECT value_json FROM settings WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
  return row ? JSON.parse(row.value_json) : undefined;
}

describe("backfillPricingDefaultsIfUnconfigured", () => {
  it("fills real Composer pricing and stamps lastVerifiedAt on a pristine seed", () => {
    const client = openDb({ filePath: ":memory:" });
    // verifyMigrations seeds the zero/null defaults, then runs the backfill.
    client.verifyMigrations();

    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastInput)).toBe(1_500_000);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastOutput)).toBe(7_500_000);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.standardInput)).toBe(500_000);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.standardOutput)).toBe(2_500_000);
    const lastVerified = readSetting(client.raw, PRICING_SETTING_KEYS.lastVerifiedAt);
    expect(typeof lastVerified).toBe("string");

    // Idempotent: a second backfill is a no-op (already configured).
    expect(backfillPricingDefaultsIfUnconfigured(client.raw)).toBe(false);
    client.close();
  });

  it("does not clobber user-edited pricing", () => {
    const client = openDb({ filePath: ":memory:", skipSeed: true });
    client.verifyMigrations(); // migrations only — no seed, no backfill
    // Seed the zero defaults, then simulate a user-set custom input rate.
    seedDefaultSettingsIfEmpty(client.raw);
    client.raw
      .prepare("UPDATE settings SET value_json = ? WHERE key = ?")
      .run(JSON.stringify(123_456), PRICING_SETTING_KEYS.fastInput);

    // Pricing is no longer all-zero, so the backfill must decline.
    expect(backfillPricingDefaultsIfUnconfigured(client.raw)).toBe(false);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastInput)).toBe(123_456);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.lastVerifiedAt)).toBeNull();
    client.close();
  });
});
