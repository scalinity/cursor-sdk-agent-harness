import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { PRICING_SETTING_KEYS } from "@harness/shared";

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
 * Official Cursor Composer pricing in micro-USD per million tokens.
 *
 * Source: https://cursor.com/blog/composer-2 (verified via Ref MCP on
 * 2026-05-24). Composer 2.5 (standard) is $0.50/M input, $2.50/M output;
 * the fast variant is $1.50/M input, $7.50/M output. Cursor publishes no
 * separate cached-input rate for Composer, so cached input is priced at the
 * regular input rate (conservative — never underestimates cost). $1.00 =
 * 1_000_000 micro-USD, so $0.50/M = 500_000.
 */
const COMPOSER_PRICING_MICROS = {
  [PRICING_SETTING_KEYS.fastInput]: 1_500_000,
  [PRICING_SETTING_KEYS.fastOutput]: 7_500_000,
  [PRICING_SETTING_KEYS.fastCachedInput]: 1_500_000,
  [PRICING_SETTING_KEYS.standardInput]: 500_000,
  [PRICING_SETTING_KEYS.standardOutput]: 2_500_000,
  [PRICING_SETTING_KEYS.standardCachedInput]: 500_000,
} as const;

const PRICING_PRICE_KEYS: ReadonlyArray<string> = Object.keys(COMPOSER_PRICING_MICROS);

/**
 * Fill in real Composer pricing when the DB is still at the pristine default
 * (every price key === 0 AND last_verified_at === null). Idempotent: once the
 * real prices are written (and last_verified_at stamped) the guard fails on
 * every subsequent boot, so a user who later edits pricing is never
 * overwritten. Returns true when a backfill was performed.
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
  const lastVerified = current.get(PRICING_SETTING_KEYS.lastVerifiedAt);
  const neverVerified = lastVerified === null || lastVerified === undefined;
  if (!allPricesZero || !neverVerified) {
    return false;
  }

  const upsert = raw.prepare(
    `INSERT INTO settings (key, value_json, description) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
  );
  const tx = raw.transaction(() => {
    for (const [key, micros] of Object.entries(COMPOSER_PRICING_MICROS)) {
      upsert.run(key, JSON.stringify(micros), null);
    }
    upsert.run(
      PRICING_SETTING_KEYS.lastVerifiedAt,
      JSON.stringify(now.toISOString()),
      null,
    );
  });
  tx();
  return true;
}
