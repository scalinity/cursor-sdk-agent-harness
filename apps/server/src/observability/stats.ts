import fs from "node:fs";
import type { ObservabilityStatsResponse } from "@harness/shared";
import type { EventsRepo } from "../db/repositories/events.repo.js";
import type { RunsRepo } from "../db/repositories/runs.repo.js";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";

export interface ObservabilityStatsDeps {
  dbPath: string;
  runs: RunsRepo;
  events: EventsRepo;
  settings: SettingsRepo;
}

function readDbBytes(dbPath: string): number | null {
  try {
    return fs.statSync(dbPath).size;
  } catch {
    return null;
  }
}

function readRetentionDays(settings: SettingsRepo): number {
  const value = settings.get<number>("rawEventRetentionDays");
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  return 180;
}

export function queryObservabilityStats(deps: ObservabilityStatsDeps): ObservabilityStatsResponse {
  return {
    runCount: deps.runs.count({ includeSubagents: true }),
    eventCount: deps.events.countAll(),
    dbBytes: readDbBytes(deps.dbPath),
    rawEventRetentionDays: readRetentionDays(deps.settings),
    capturedAt: new Date().toISOString(),
  };
}
