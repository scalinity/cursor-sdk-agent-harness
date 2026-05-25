import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { DEFAULT_PRICING_MICROS, PRICING_SETTING_KEYS } from "@harness/shared";

// Default settings seed — spec §8 → Default Settings Seed. Inserts only when
// the settings table is empty so we never overwrite a user-edited value.
//
// Pricing keys seed to 0 / last_verified_at=null (the "unconfigured" baseline).
// `backfillPricingDefaultsIfUnconfigured` (run on every boot) detects that
// pristine state and fills in the real Cursor Composer prices, so both fresh
// installs and previously-seeded DBs end up with correct, verified pricing
// without clobbering any value a user has edited.

type SeedRow = { key: string; valueJson: string; description: string };

const DEFAULT_SEED: ReadonlyArray<SeedRow> = [
  {
    key: "defaultModelId",
    valueJson: JSON.stringify("composer-2-5-fast"),
    description: "Default model for new agents",
  },
  {
    key: "defaultSettingSources",
    valueJson: JSON.stringify(["project", "user"]),
    description: "Default Cursor setting sources for local agents",
  },
  {
    key: "sandboxEnabledByDefault",
    valueJson: JSON.stringify(true),
    description: "Whether local sandboxing is enabled by default",
  },
  {
    key: "defaultReplaySpeed",
    valueJson: JSON.stringify("instant"),
    description: "Default run replay speed",
  },
  {
    key: "rawEventRetentionDays",
    valueJson: JSON.stringify(180),
    description: "Retention period for raw SDK event JSON",
  },
  {
    key: "pricing.composer-2-5-fast.input_per_million_usd_micros",
    valueJson: JSON.stringify(0),
    description: "Fast model input price in micro-USD per million tokens",
  },
  {
    key: "pricing.composer-2-5-fast.output_per_million_usd_micros",
    valueJson: JSON.stringify(0),
    description: "Fast model output price in micro-USD per million tokens",
  },
  {
    key: "pricing.composer-2-5-fast.cached_input_per_million_usd_micros",
    valueJson: JSON.stringify(0),
    description: "Fast model cached input price in micro-USD per million tokens",
  },
  {
    key: "pricing.composer-2-5.input_per_million_usd_micros",
    valueJson: JSON.stringify(0),
    description: "Standard model input price in micro-USD per million tokens",
  },
  {
    key: "pricing.composer-2-5.output_per_million_usd_micros",
    valueJson: JSON.stringify(0),
    description: "Standard model output price in micro-USD per million tokens",
  },
  {
    key: "pricing.composer-2-5.cached_input_per_million_usd_micros",
    valueJson: JSON.stringify(0),
    description: "Standard model cached input price in micro-USD per million tokens",
  },
  {
    key: "pricing.promo_multiplier",
    valueJson: JSON.stringify(1.0),
    description: "Multiplier applied to computed cost, e.g. 0.1 for a 90% promo",
  },
  {
    key: "pricing.last_verified_at",
    valueJson: JSON.stringify(null),
    description: "Timestamp when pricing settings were last verified",
  },
];

export function seedDefaultSettingsIfEmpty(raw: BetterSqlite3Database): boolean {
  const existing = raw.prepare("SELECT COUNT(*) as count FROM settings").get() as {
    count: number;
  };
  if (existing.count > 0) {
    return false;
  }

  const insert = raw.prepare(
    "INSERT INTO settings (key, value_json, description) VALUES (?, ?, ?)",
  );
  const tx = raw.transaction((rows: ReadonlyArray<SeedRow>) => {
    for (const row of rows) {
      insert.run(row.key, row.valueJson, row.description);
    }
  });
  tx(DEFAULT_SEED);
  return true;
}

export const DEFAULT_SETTING_KEYS: ReadonlyArray<string> = DEFAULT_SEED.map(
  (row) => row.key,
);

/**
 * Official Cursor Composer 2.5 pricing in micro-USD per million tokens.
 * Source: cursor.com/docs/models-and-pricing (verified 2026-05-24).
 * Derived from the shared DEFAULT_PRICING_MICROS constant.
 */
const COMPOSER_PRICING_MICROS: Record<string, number> = {
  [PRICING_SETTING_KEYS.fastInput]: DEFAULT_PRICING_MICROS.composer25Fast.inputPerMillionUsdMicros,
  [PRICING_SETTING_KEYS.fastOutput]: DEFAULT_PRICING_MICROS.composer25Fast.outputPerMillionUsdMicros,
  [PRICING_SETTING_KEYS.fastCachedInput]: DEFAULT_PRICING_MICROS.composer25Fast.cachedInputPerMillionUsdMicros,
  [PRICING_SETTING_KEYS.standardInput]: DEFAULT_PRICING_MICROS.composer25.inputPerMillionUsdMicros,
  [PRICING_SETTING_KEYS.standardOutput]: DEFAULT_PRICING_MICROS.composer25.outputPerMillionUsdMicros,
  [PRICING_SETTING_KEYS.standardCachedInput]: DEFAULT_PRICING_MICROS.composer25.cachedInputPerMillionUsdMicros,
};

// Stale Composer 2 prices that a prior backfill may have written.
const STALE_COMPOSER_2_PRICES = new Set([1_500_000, 7_500_000]);

const PRICING_PRICE_KEYS: ReadonlyArray<string> = Object.keys(COMPOSER_PRICING_MICROS);

/**
 * Fill in real Composer 2.5 pricing when the DB is at a pristine default
 * (every price key === 0) OR still holds stale Composer 2 prices from an
 * earlier backfill. Idempotent: once the current prices are written the guard
 * fails on subsequent boots, so user-edited pricing is never overwritten.
 */
export function backfillPricingDefaultsIfUnconfigured(
  raw: BetterSqlite3Database,
  now: Date = new Date(),
): boolean {
  const keys = [...PRICING_PRICE_KEYS, PRICING_SETTING_KEYS.lastVerifiedAt];
  const placeholders = keys.map(() => "?").join(",");
  const rows = raw
    .prepare(`SELECT key, value_json FROM settings WHERE key IN (${placeholders})`)
    .all(...keys) as Array<{ key: string; value_json: string }>;
  const current = new Map<string, unknown>();
  for (const row of rows) current.set(row.key, JSON.parse(row.value_json));

  const allPricesZero = PRICING_PRICE_KEYS.every((key) => current.get(key) === 0);
  const hasStaleComposer2 = !allPricesZero && PRICING_PRICE_KEYS.every((key) => {
    const v = current.get(key);
    return v === 0 || STALE_COMPOSER_2_PRICES.has(v as number) || v === 500_000 || v === 2_500_000;
  });
  const alreadyCurrent = PRICING_PRICE_KEYS.every(
    (key) => current.get(key) === COMPOSER_PRICING_MICROS[key],
  );

  if (alreadyCurrent) return false;
  if (!allPricesZero && !hasStaleComposer2) return false;

  const upsert = raw.prepare(
    `INSERT INTO settings (key, value_json, description, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  );
  const ts = now.toISOString();
  const tx = raw.transaction(() => {
    for (const [key, micros] of Object.entries(COMPOSER_PRICING_MICROS)) {
      upsert.run(key, JSON.stringify(micros), null, ts);
    }
    upsert.run(
      PRICING_SETTING_KEYS.lastVerifiedAt,
      JSON.stringify(now.toISOString()),
      null,
      ts,
    );
  });
  tx();
  return true;
}
