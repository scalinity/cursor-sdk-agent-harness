import {
  DEFAULT_PRICING_MICROS,
  PRICING_SETTING_KEYS,
  themeSettingSchema,
  type SettingsSnapshot,
  type UpdateSettingsRequest,
  type UpdatePricingRequest,
} from "@harness/shared";
import type { SettingWrite, SettingsRepo } from "../db/repositories/settings.repo.js";

const TOP_LEVEL_KEYS = {
  defaultModelId: "defaultModelId",
  defaultExecutionMode: "app.defaultExecutionMode",
  defaultSettingSources: "defaultSettingSources",
  sandboxEnabledByDefault: "sandboxEnabledByDefault",
  defaultReplaySpeed: "defaultReplaySpeed",
  rawEventRetentionDays: "rawEventRetentionDays",
  uiTheme: "settings.ui.theme",
} as const;

const SNAPSHOT_KEYS: ReadonlyArray<string> = [
  TOP_LEVEL_KEYS.defaultModelId,
  TOP_LEVEL_KEYS.defaultExecutionMode,
  TOP_LEVEL_KEYS.defaultSettingSources,
  TOP_LEVEL_KEYS.sandboxEnabledByDefault,
  TOP_LEVEL_KEYS.defaultReplaySpeed,
  TOP_LEVEL_KEYS.rawEventRetentionDays,
  TOP_LEVEL_KEYS.uiTheme,
  PRICING_SETTING_KEYS.fastInput,
  PRICING_SETTING_KEYS.fastOutput,
  PRICING_SETTING_KEYS.fastCachedInput,
  PRICING_SETTING_KEYS.standardInput,
  PRICING_SETTING_KEYS.standardOutput,
  PRICING_SETTING_KEYS.standardCachedInput,
  PRICING_SETTING_KEYS.promoMultiplier,
  PRICING_SETTING_KEYS.lastVerifiedAt,
];

function pickNumber(map: Map<string, unknown>, key: string, fallback: number): number {
  const raw = map.get(key);
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return raw;
}

function pickString<T extends string>(
  map: Map<string, unknown>,
  key: string,
  fallback: T,
): T {
  const raw = map.get(key);
  return typeof raw === "string" ? (raw as T) : fallback;
}

function pickBoolean(map: Map<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = map.get(key);
  return typeof raw === "boolean" ? raw : fallback;
}

function pickStringArray<T extends string>(
  map: Map<string, unknown>,
  key: string,
  fallback: T[],
): T[] {
  const raw = map.get(key);
  return Array.isArray(raw) ? (raw as T[]) : fallback;
}

function pickTheme(map: Map<string, unknown>, key: string): SettingsSnapshot["ui"]["theme"] {
  const parsed = themeSettingSchema.safeParse(map.get(key));
  return parsed.success ? parsed.data : "dark";
}

function pickNullableString(
  map: Map<string, unknown>,
  key: string,
): string | null {
  const raw = map.get(key);
  if (typeof raw === "string") return raw;
  return null;
}

export function getSettingsSnapshot(repo: SettingsRepo): SettingsSnapshot {
  // Single SELECT for every key the snapshot cares about, then assemble in JS.
  const m = repo.getMany(SNAPSHOT_KEYS);
  const snapshot: SettingsSnapshot = {
    defaultModelId: pickString<SettingsSnapshot["defaultModelId"]>(
      m,
      TOP_LEVEL_KEYS.defaultModelId,
      "composer-2-5-fast",
    ),
    defaultExecutionMode: pickString<SettingsSnapshot["defaultExecutionMode"]>(
      m,
      TOP_LEVEL_KEYS.defaultExecutionMode,
      "agent",
    ),
    defaultSettingSources: pickStringArray<
      SettingsSnapshot["defaultSettingSources"][number]
    >(m, TOP_LEVEL_KEYS.defaultSettingSources, ["project", "user"]),
    sandboxEnabledByDefault: pickBoolean(
      m,
      TOP_LEVEL_KEYS.sandboxEnabledByDefault,
      true,
    ),
    defaultReplaySpeed: pickString<SettingsSnapshot["defaultReplaySpeed"]>(
      m,
      TOP_LEVEL_KEYS.defaultReplaySpeed,
      "instant",
    ),
    rawEventRetentionDays: pickNumber(m, TOP_LEVEL_KEYS.rawEventRetentionDays, 180),
    ui: {
      theme: pickTheme(m, TOP_LEVEL_KEYS.uiTheme),
    },
    pricing: {
      composer25Fast: {
        inputPerMillionUsdMicros: pickNumber(m, PRICING_SETTING_KEYS.fastInput, DEFAULT_PRICING_MICROS.composer25Fast.inputPerMillionUsdMicros),
        outputPerMillionUsdMicros: pickNumber(m, PRICING_SETTING_KEYS.fastOutput, DEFAULT_PRICING_MICROS.composer25Fast.outputPerMillionUsdMicros),
        cachedInputPerMillionUsdMicros: pickNumber(
          m,
          PRICING_SETTING_KEYS.fastCachedInput,
          DEFAULT_PRICING_MICROS.composer25Fast.cachedInputPerMillionUsdMicros,
        ),
      },
      composer25: {
        inputPerMillionUsdMicros: pickNumber(m, PRICING_SETTING_KEYS.standardInput, DEFAULT_PRICING_MICROS.composer25.inputPerMillionUsdMicros),
        outputPerMillionUsdMicros: pickNumber(
          m,
          PRICING_SETTING_KEYS.standardOutput,
          DEFAULT_PRICING_MICROS.composer25.outputPerMillionUsdMicros,
        ),
        cachedInputPerMillionUsdMicros: pickNumber(
          m,
          PRICING_SETTING_KEYS.standardCachedInput,
          DEFAULT_PRICING_MICROS.composer25.cachedInputPerMillionUsdMicros,
        ),
      },
      promoMultiplier: pickNumber(m, PRICING_SETTING_KEYS.promoMultiplier, 1.0),
      lastVerifiedAt: pickNullableString(m, PRICING_SETTING_KEYS.lastVerifiedAt),
    },
  };
  return snapshot;
}

export function applySettingsUpdate(
  repo: SettingsRepo,
  patch: UpdateSettingsRequest,
): SettingsSnapshot {
  const writes: SettingWrite[] = [];
  if (patch.defaultModelId !== undefined) {
    writes.push({ key: TOP_LEVEL_KEYS.defaultModelId, value: patch.defaultModelId });
  }
  if (patch.defaultExecutionMode !== undefined) {
    writes.push({ key: TOP_LEVEL_KEYS.defaultExecutionMode, value: patch.defaultExecutionMode });
  }
  if (patch.defaultSettingSources !== undefined) {
    writes.push({ key: TOP_LEVEL_KEYS.defaultSettingSources, value: patch.defaultSettingSources });
  }
  if (patch.sandboxEnabledByDefault !== undefined) {
    writes.push({ key: TOP_LEVEL_KEYS.sandboxEnabledByDefault, value: patch.sandboxEnabledByDefault });
  }
  if (patch.defaultReplaySpeed !== undefined) {
    writes.push({ key: TOP_LEVEL_KEYS.defaultReplaySpeed, value: patch.defaultReplaySpeed });
  }
  if (patch.rawEventRetentionDays !== undefined) {
    writes.push({ key: TOP_LEVEL_KEYS.rawEventRetentionDays, value: patch.rawEventRetentionDays });
  }
  if (patch.ui?.theme !== undefined) {
    writes.push({ key: TOP_LEVEL_KEYS.uiTheme, value: patch.ui.theme });
  }
  repo.setMany(writes);
  return getSettingsSnapshot(repo);
}

export function applyPricingUpdate(
  repo: SettingsRepo,
  patch: UpdatePricingRequest,
  now: Date = new Date(),
): SettingsSnapshot {
  const writes: SettingWrite[] = [];
  if (patch.composer25Fast?.inputPerMillionUsdMicros !== undefined) {
    writes.push({
      key: PRICING_SETTING_KEYS.fastInput,
      value: patch.composer25Fast.inputPerMillionUsdMicros,
    });
  }
  if (patch.composer25Fast?.outputPerMillionUsdMicros !== undefined) {
    writes.push({
      key: PRICING_SETTING_KEYS.fastOutput,
      value: patch.composer25Fast.outputPerMillionUsdMicros,
    });
  }
  if (patch.composer25Fast?.cachedInputPerMillionUsdMicros !== undefined) {
    writes.push({
      key: PRICING_SETTING_KEYS.fastCachedInput,
      value: patch.composer25Fast.cachedInputPerMillionUsdMicros,
    });
  }
  if (patch.composer25?.inputPerMillionUsdMicros !== undefined) {
    writes.push({
      key: PRICING_SETTING_KEYS.standardInput,
      value: patch.composer25.inputPerMillionUsdMicros,
    });
  }
  if (patch.composer25?.outputPerMillionUsdMicros !== undefined) {
    writes.push({
      key: PRICING_SETTING_KEYS.standardOutput,
      value: patch.composer25.outputPerMillionUsdMicros,
    });
  }
  if (patch.composer25?.cachedInputPerMillionUsdMicros !== undefined) {
    writes.push({
      key: PRICING_SETTING_KEYS.standardCachedInput,
      value: patch.composer25.cachedInputPerMillionUsdMicros,
    });
  }
  if (patch.promoMultiplier !== undefined) {
    writes.push({ key: PRICING_SETTING_KEYS.promoMultiplier, value: patch.promoMultiplier });
  }
  if (patch.markVerified === true) {
    writes.push({ key: PRICING_SETTING_KEYS.lastVerifiedAt, value: now.toISOString() });
  }
  repo.setMany(writes);
  return getSettingsSnapshot(repo);
}
