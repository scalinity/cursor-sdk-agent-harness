import type { Database as BetterSqlite3Database } from "better-sqlite3";

// Default settings seed — spec §8 → Default Settings Seed. Inserts only when
// the settings table is empty so we never overwrite a user-edited value.

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
