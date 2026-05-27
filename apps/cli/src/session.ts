import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliAgentSummary, CliMode } from "./types.js";
import type { StreamBuffer } from "./repl/StreamView.js";
import type { SessionCostState } from "./repl/StatusBar.js";
import { CONFIG_DIR } from "./config.js";

export const SESSION_PATH = path.join(CONFIG_DIR, "last-session.json");

function resolveSessionPath(): string {
  return process.env.HARNESS_CLI_SESSION_PATH ?? SESSION_PATH;
}

export interface CliSessionSnapshot {
  version: 1;
  savedAt: string;
  workspace: string;
  agent: CliAgentSummary;
  mode: CliMode;
  modelId: string;
  sessionCost: SessionCostState;
  buffer: StreamBuffer;
  scrollOffset: number;
}

export function isCliSessionSnapshot(value: unknown): value is CliSessionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return false;
  if (typeof record.savedAt !== "string") return false;
  if (typeof record.workspace !== "string" || record.workspace.length === 0) return false;
  if (record.mode !== "ask" && record.mode !== "agent") return false;
  if (typeof record.modelId !== "string" || record.modelId.length === 0) return false;
  if (typeof record.scrollOffset !== "number" || !Number.isFinite(record.scrollOffset)) return false;
  if (!isSessionCost(record.sessionCost)) return false;
  if (!isAgentSummary(record.agent)) return false;
  if (!isStreamBuffer(record.buffer)) return false;
  return true;
}

function isSessionCost(value: unknown): value is SessionCostState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.micros === "number"
    && Number.isFinite(record.micros)
    && typeof record.hasUnavailableTurn === "boolean";
}

function isAgentSummary(value: unknown): value is CliAgentSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.name === "string"
    && typeof record.modelId === "string"
    && (record.executionMode === "ask" || record.executionMode === "agent");
}

function isStreamBuffer(value: unknown): value is StreamBuffer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const items = (value as StreamBuffer).items;
  return Array.isArray(items);
}

export async function readLastSession(): Promise<CliSessionSnapshot | null> {
  try {
    const raw = await readFile(resolveSessionPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isCliSessionSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeLastSession(snapshot: CliSessionSnapshot): Promise<void> {
  const targetPath = resolveSessionPath();
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, targetPath);
}

export function createSessionSnapshot(input: {
  workspace: string;
  agent: CliAgentSummary;
  mode: CliMode;
  modelId: string;
  sessionCost: SessionCostState;
  buffer: StreamBuffer;
  scrollOffset: number;
  savedAt?: Date;
}): CliSessionSnapshot {
  return {
    version: 1,
    savedAt: (input.savedAt ?? new Date()).toISOString(),
    workspace: path.resolve(input.workspace),
    agent: input.agent,
    mode: input.mode,
    modelId: input.modelId,
    sessionCost: input.sessionCost,
    buffer: input.buffer,
    scrollOffset: Math.max(0, Math.floor(input.scrollOffset)),
  };
}
