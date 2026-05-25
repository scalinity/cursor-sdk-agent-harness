import { describe, it, expect } from "vitest";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { DEFAULT_PRICING_MICROS, PRICING_SETTING_KEYS } from "@harness/shared";
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
  it("fills Composer 2.5 pricing and stamps lastVerifiedAt on a pristine seed", () => {
    const client = openDb({ filePath: ":memory:" });
    client.verifyMigrations();

    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastInput)).toBe(DEFAULT_PRICING_MICROS.composer25Fast.inputPerMillionUsdMicros);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastOutput)).toBe(DEFAULT_PRICING_MICROS.composer25Fast.outputPerMillionUsdMicros);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastCachedInput)).toBe(DEFAULT_PRICING_MICROS.composer25Fast.cachedInputPerMillionUsdMicros);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.standardInput)).toBe(DEFAULT_PRICING_MICROS.composer25.inputPerMillionUsdMicros);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.standardOutput)).toBe(DEFAULT_PRICING_MICROS.composer25.outputPerMillionUsdMicros);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.standardCachedInput)).toBe(DEFAULT_PRICING_MICROS.composer25.cachedInputPerMillionUsdMicros);
    const lastVerified = readSetting(client.raw, PRICING_SETTING_KEYS.lastVerifiedAt);
    expect(typeof lastVerified).toBe("string");

    // Idempotent: a second backfill is a no-op (already current).
    expect(backfillPricingDefaultsIfUnconfigured(client.raw)).toBe(false);
    client.close();
  });

  it("upgrades stale Composer 2 prices to Composer 2.5 on boot", () => {
    const client = openDb({ filePath: ":memory:", skipSeed: true });
    client.verifyMigrations();
    seedDefaultSettingsIfEmpty(client.raw);
    // Simulate the old Composer 2 backfill values
    const oldPrices: Record<string, number> = {
      [PRICING_SETTING_KEYS.fastInput]: 1_500_000,
      [PRICING_SETTING_KEYS.fastOutput]: 7_500_000,
      [PRICING_SETTING_KEYS.fastCachedInput]: 1_500_000,
      [PRICING_SETTING_KEYS.standardInput]: 500_000,
      [PRICING_SETTING_KEYS.standardOutput]: 2_500_000,
      [PRICING_SETTING_KEYS.standardCachedInput]: 500_000,
    };
    for (const [key, value] of Object.entries(oldPrices)) {
      client.raw
        .prepare("UPDATE settings SET value_json = ? WHERE key = ?")
        .run(JSON.stringify(value), key);
    }

    expect(backfillPricingDefaultsIfUnconfigured(client.raw)).toBe(true);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastInput)).toBe(DEFAULT_PRICING_MICROS.composer25Fast.inputPerMillionUsdMicros);
    expect(readSetting(client.raw, PRICING_SETTING_KEYS.fastOutput)).toBe(DEFAULT_PRICING_MICROS.composer25Fast.outputPerMillionUsdMicros);
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
