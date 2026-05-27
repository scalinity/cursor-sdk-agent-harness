import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import type { CliAgentSummary, CliMode } from "./types.js";
import type { StreamBuffer } from "./repl/StreamView.js";
import type { SessionCostState, SessionTokenState } from "./repl/StatusBar.js";
import { CONFIG_DIR } from "./config.js";

export const SESSION_PATH = path.join(CONFIG_DIR, "last-session.json");
const MAX_SESSION_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_ITEMS = 5000;

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
  sessionTokens: SessionTokenState;
  buffer: StreamBuffer;
  scrollOffset: number;
}

export function isCliSessionSnapshot(value: unknown): value is CliSessionSnapshot {
  const normalized = normalizeCliSessionSnapshot(value);
  if (!normalized || !value || typeof value !== "object" || Array.isArray(value)) return false;
  Object.assign(value, normalized);
  return true;
}

function normalizeCliSessionSnapshot(value: unknown): CliSessionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.savedAt !== "string") return null;
  if (typeof record.workspace !== "string" || record.workspace.length === 0) return null;
  if (record.mode !== "ask" && record.mode !== "agent") return null;
  if (typeof record.modelId !== "string" || record.modelId.length === 0) return null;
  if (typeof record.scrollOffset !== "number" || !Number.isFinite(record.scrollOffset)) return null;
  if (!isSessionCost(record.sessionCost)) return null;
  if (!isAgentSummary(record.agent)) return null;
  if (!isStreamBuffer(record.buffer)) return null;
  const sessionTokens = resolveSessionTokens(record.sessionTokens, record.buffer);
  if (!sessionTokens) return null;
  return {
    version: 1,
    savedAt: record.savedAt,
    workspace: record.workspace,
    agent: record.agent,
    mode: record.mode,
    modelId: record.modelId,
    sessionCost: record.sessionCost,
    sessionTokens,
    buffer: record.buffer,
    scrollOffset: record.scrollOffset,
  };
}

function isSessionCost(value: unknown): value is SessionCostState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.micros === "number"
    && Number.isFinite(record.micros)
    && typeof record.hasUnavailableTurn === "boolean";
}

function isSessionTokens(value: unknown): value is SessionTokenState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.tokens === "number"
    && Number.isFinite(record.tokens)
    && typeof record.hasUnavailableTurn === "boolean";
}

function resolveSessionTokens(value: unknown, buffer: StreamBuffer): SessionTokenState | null {
  if (value === undefined) return summarizeTokensFromBuffer(buffer);
  return isSessionTokens(value) ? value : null;
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
  return Array.isArray(items) && items.length <= MAX_SESSION_ITEMS && items.every(isStreamItem);
}

function isStreamItem(value: unknown): value is StreamBuffer["items"][number] {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "user":
      return typeof value.text === "string" && typeof value.at === "string";
    case "assistant":
    case "system":
      return typeof value.text === "string";
    case "thinking":
      return typeof value.text === "string" && isOptionalBoolean(value.collapsed);
    case "error":
      return typeof value.message === "string";
    case "approval":
      return typeof value.requestId === "string" && typeof value.description === "string";
    case "summary":
      return typeof value.status === "string"
        && isNullableFiniteNumber(value.tokens)
        && isNullableFiniteNumber(value.costMicros)
        && isNullableFiniteNumber(value.durationMs);
    case "diff":
      return typeof value.path === "string"
        && isOptionalString(value.language)
        && isOptionalString(value.before)
        && isOptionalString(value.after)
        && isOptionalString(value.unifiedDiff);
    case "tool":
      return typeof value.callId === "string"
        && typeof value.name === "string"
        && isToolStatus(value.status)
        && typeof value.verb === "string"
        && typeof value.primaryArg === "string"
        && isOptionalString(value.secondaryDetail)
        && isOptionalFiniteNumber(value.durationMs)
        && isOptionalString(value.error);
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isToolStatus(value: unknown): boolean {
  return value === "running" || value === "completed" || value === "error" || value === "cancelled";
}

function summarizeTokensFromBuffer(buffer: StreamBuffer): SessionTokenState {
  let tokens = 0;
  let hasUnavailableTurn = false;
  for (const item of buffer.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "summary" || record.status !== "FINISHED") continue;
    if (typeof record.tokens === "number" && Number.isFinite(record.tokens)) tokens += record.tokens;
    else hasUnavailableTurn = true;
  }
  return { tokens, hasUnavailableTurn };
}

export async function readLastSession(): Promise<CliSessionSnapshot | null> {
  const targetPath = resolveSessionPath();
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new CliUsageError("Saved chat session is not a regular file.");
  }
  if (fileStat.size > MAX_SESSION_BYTES) {
    throw new CliUsageError("Saved chat session is too large to resume safely.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(targetPath, "utf8"));
  } catch (error) {
    throw new CliUsageError(`Saved chat session is corrupt: ${error instanceof Error ? error.message : String(error)}`);
  }
  const normalized = normalizeCliSessionSnapshot(parsed);
  if (!normalized) {
    throw new CliUsageError("Saved chat session has an unsupported or corrupt shape.");
  }
  return normalized;
}

export async function writeLastSession(snapshot: CliSessionSnapshot): Promise<void> {
  if (!isCliSessionSnapshot(snapshot)) {
    throw new CliUsageError("Refusing to write an invalid chat session snapshot.");
  }
  const targetPath = resolveSessionPath();
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, targetPath);
}

export function createSessionSnapshot(input: {
  workspace: string;
  agent: CliAgentSummary;
  mode: CliMode;
  modelId: string;
  sessionCost: SessionCostState;
  sessionTokens?: SessionTokenState;
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
    sessionTokens: input.sessionTokens ?? summarizeTokensFromBuffer(input.buffer),
    buffer: input.buffer,
    scrollOffset: Math.max(0, Math.floor(input.scrollOffset)),
  };
}
