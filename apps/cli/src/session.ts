import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import type { CliAgentSummary, CliMode } from "./types.js";
import type { StreamBuffer, StreamItem } from "./repl/StreamView.js";
import type { SessionCostState, SessionTokenState } from "./repl/StatusBar.js";
import { CONFIG_DIR } from "./config.js";

export const SESSION_PATH = path.join(CONFIG_DIR, "last-session.json");
const MAX_SESSION_ITEMS = 200;
const MAX_SESSION_TEXT_CHARS = 4000;
const MAX_SESSION_BYTES = 1024 * 1024;
const MAX_SESSION_SCROLL_OFFSET = 50000;
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16})\b|\b(?:password|secret|token)\s*[:=]\s*\S+/gi;

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
  const buffer = normalizeStreamBuffer(record.buffer);
  if (!buffer) return null;
  const sessionTokens = resolveSessionTokens(record.sessionTokens, buffer);
  if (!sessionTokens) return null;
  return sanitizeCliSessionSnapshot({
    version: 1,
    savedAt: record.savedAt,
    workspace: record.workspace,
    agent: record.agent,
    mode: record.mode,
    modelId: record.modelId,
    sessionCost: record.sessionCost,
    sessionTokens,
    buffer,
    scrollOffset: record.scrollOffset,
  });
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

function normalizeStreamBuffer(value: unknown): StreamBuffer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const normalized: StreamItem[] = [];
  for (const item of items) {
    const next = normalizeStreamItem(item);
    if (!next) return null;
    normalized.push(next);
  }
  return { items: normalized };
}

function normalizeStreamItem(value: unknown): StreamItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "user":
      return typeof record.text === "string" && typeof record.at === "string"
        ? { type: "user", text: record.text, at: record.at }
        : null;
    case "assistant":
      return typeof record.text === "string" ? { type: "assistant", text: record.text } : null;
    case "thinking":
      return typeof record.text === "string"
        ? { type: "thinking", text: record.text, ...(typeof record.collapsed === "boolean" ? { collapsed: record.collapsed } : {}) }
        : null;
    case "tool":
      return normalizeToolItem(record);
    case "diff":
      return typeof record.path === "string"
        ? {
            type: "diff",
            path: record.path,
            ...(typeof record.language === "string" ? { language: record.language } : {}),
            ...(typeof record.before === "string" ? { before: record.before } : {}),
            ...(typeof record.after === "string" ? { after: record.after } : {}),
            ...(typeof record.unifiedDiff === "string" ? { unifiedDiff: record.unifiedDiff } : {}),
          }
        : null;
    case "approval":
      return typeof record.requestId === "string" && typeof record.description === "string"
        ? { type: "approval", requestId: record.requestId, description: record.description }
        : null;
    case "summary":
      return typeof record.status === "string" && isNullableFiniteNumber(record.tokens) && isNullableFiniteNumber(record.costMicros) && isNullableFiniteNumber(record.durationMs)
        ? {
            type: "summary",
            status: record.status,
            tokens: record.tokens,
            tokensPartial: typeof record.tokensPartial === "boolean" ? record.tokensPartial : false,
            costMicros: record.costMicros,
            costUnavailable: typeof record.costUnavailable === "boolean" ? record.costUnavailable : record.costMicros === null,
            durationMs: record.durationMs,
          }
        : null;
    case "task":
      return typeof record.status === "string" && typeof record.text === "string"
        ? { type: "task", status: record.status, text: record.text }
        : null;
    case "subagent": {
      if (
        typeof record.childRunId !== "string"
        || typeof record.sourceCallId !== "string"
        || typeof record.name !== "string"
        || (record.phase !== "spawned" && record.phase !== "completed")
        || typeof record.status !== "string"
      ) {
        return null;
      }
      const toolCalls = normalizeSubagentToolCalls(record.toolCalls);
      return {
        type: "subagent",
        childRunId: record.childRunId,
        sourceCallId: record.sourceCallId,
        name: record.name,
        phase: record.phase,
        status: record.status,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }
    case "system":
      return typeof record.text === "string" ? { type: "system", text: record.text } : null;
    case "error":
      return typeof record.message === "string" ? { type: "error", message: record.message } : null;
    default:
      return null;
  }
}

function normalizeSubagentToolCalls(value: unknown): NonNullable<Extract<StreamItem, { type: "subagent" }>["toolCalls"]> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<Extract<StreamItem, { type: "subagent" }>["toolCalls"]> = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.ok !== "boolean") continue;
    out.push({
      name: record.name,
      detail: typeof record.detail === "string" ? record.detail : "",
      ok: record.ok,
    });
  }
  return out;
}

function normalizeToolItem(record: Record<string, unknown>): StreamItem | null {
  const status = record.status;
  if (status !== "running" && status !== "completed" && status !== "error" && status !== "cancelled") return null;
  if (typeof record.callId !== "string" || typeof record.name !== "string" || typeof record.verb !== "string" || typeof record.primaryArg !== "string") return null;
  return {
    type: "tool",
    callId: record.callId,
    name: record.name,
    status,
    verb: record.verb,
    primaryArg: record.primaryArg,
    ...(typeof record.secondaryDetail === "string" ? { secondaryDetail: record.secondaryDetail } : {}),
    ...(typeof record.durationMs === "number" && Number.isFinite(record.durationMs) ? { durationMs: record.durationMs } : {}),
    ...(typeof record.error === "string" ? { error: record.error } : {}),
  };
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function summarizeTokensFromBuffer(buffer: StreamBuffer): SessionTokenState {
  let tokens = 0;
  let hasUnavailableTurn = false;
  for (const item of buffer.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "summary" || record.status !== "FINISHED") continue;
    if (record.tokensPartial === true) hasUnavailableTurn = true;
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
  const targetPath = resolveSessionPath();
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  let renamed = false;
  try {
    await writeFile(tmpPath, `${JSON.stringify(sanitizeCliSessionSnapshot(snapshot), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, targetPath);
    renamed = true;
  } finally {
    if (!renamed) await rm(tmpPath, { force: true });
  }
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
  return sanitizeCliSessionSnapshot({
    version: 1,
    savedAt: (input.savedAt ?? new Date()).toISOString(),
    workspace: path.resolve(input.workspace),
    agent: input.agent,
    mode: input.mode,
    modelId: input.modelId,
    sessionCost: input.sessionCost,
    sessionTokens: input.sessionTokens ?? summarizeTokensFromBuffer(input.buffer),
    buffer: input.buffer,
    scrollOffset: input.scrollOffset,
  });
}

function sanitizeCliSessionSnapshot(snapshot: CliSessionSnapshot): CliSessionSnapshot {
  const buffer = sanitizeStreamBuffer(snapshot.buffer);
  return {
    ...snapshot,
    workspace: path.resolve(snapshot.workspace),
    agent: {
      ...snapshot.agent,
      name: sanitizeText(snapshot.agent.name),
    },
    modelId: sanitizeText(snapshot.modelId),
    buffer,
    scrollOffset: Math.min(MAX_SESSION_SCROLL_OFFSET, Math.max(0, Math.floor(snapshot.scrollOffset))),
  };
}

function sanitizeStreamBuffer(buffer: StreamBuffer): StreamBuffer {
  return {
    items: buffer.items.slice(-MAX_SESSION_ITEMS).map(sanitizeStreamItem),
  };
}

function sanitizeStreamItem(item: StreamItem): StreamItem {
  switch (item.type) {
    case "user":
      return { ...item, text: sanitizeText(item.text), at: sanitizeText(item.at) };
    case "assistant":
    case "thinking":
    case "system":
      return { ...item, text: sanitizeText(item.text) };
    case "error":
      return { ...item, message: sanitizeText(item.message) };
    case "tool":
      return {
        ...item,
        callId: sanitizeText(item.callId),
        name: sanitizeText(item.name),
        verb: sanitizeText(item.verb),
        primaryArg: sanitizeText(item.primaryArg),
        ...(item.secondaryDetail !== undefined ? { secondaryDetail: sanitizeText(item.secondaryDetail) } : {}),
        ...(item.error !== undefined ? { error: sanitizeText(item.error) } : {}),
      };
    case "diff":
      return {
        ...item,
        path: sanitizeText(item.path),
        ...(item.language !== undefined ? { language: sanitizeText(item.language) } : {}),
        ...(item.before !== undefined ? { before: sanitizeText(item.before) } : {}),
        ...(item.after !== undefined ? { after: sanitizeText(item.after) } : {}),
        ...(item.unifiedDiff !== undefined ? { unifiedDiff: sanitizeText(item.unifiedDiff) } : {}),
      };
    case "approval":
      return { ...item, requestId: sanitizeText(item.requestId), description: sanitizeText(item.description) };
    case "summary":
      return item;
    case "task":
      return { ...item, status: sanitizeText(item.status), text: sanitizeText(item.text) };
    case "subagent":
      return {
        ...item,
        childRunId: sanitizeText(item.childRunId),
        sourceCallId: sanitizeText(item.sourceCallId),
        name: sanitizeText(item.name),
        status: sanitizeText(item.status),
        ...(item.toolCalls
          ? { toolCalls: item.toolCalls.map((tc) => ({ ...tc, name: sanitizeText(tc.name), detail: sanitizeText(tc.detail) })) }
          : {}),
      };
  }
}

function sanitizeText(value: string): string {
  const redacted = value.replace(SECRET_PATTERN, "[redacted]");
  if (redacted.length <= MAX_SESSION_TEXT_CHARS) return redacted;
  return `${redacted.slice(0, MAX_SESSION_TEXT_CHARS)}…`;
}