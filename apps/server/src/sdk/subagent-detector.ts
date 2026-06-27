import { createHash } from "node:crypto";
import type { SDKMessage, SubagentToolCallSummary } from "@harness/shared";
import type { CanonicalRunEventDraft } from "./normalizer.js";

export interface DetectedSubagent {
  name: string;
  callId: string;
  parentRunId: string;
}

export interface DetectSubagentSpawnOptions {
  parentRunId: string;
  configuredSubagentNames?: ReadonlyArray<string>;
}

export interface SubagentLifecycleDetection {
  childRunId: string;
  name: string;
  status: "RUNNING" | "FINISHED" | "ERROR";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null;
}

function getStringAt(value: unknown, path: ReadonlyArray<string>): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
}

function boundedSubagentName(value: string): string {
  const trimmed = value.trim();
  return (trimmed.length > 0 ? trimmed : "Sub-agent").slice(0, 256);
}

function looksLikeSubagentName(value: string | null): boolean {
  if (value === null) return false;
  return /(^|[_:/\s-])(subagent|sub-agent|agent)([_:/\s-]|$)/iu.test(value);
}

function looksLikeSubagentMcpName(...values: Array<string | null>): boolean {
  return values.some(looksLikeSubagentName);
}

function matchesConfiguredName(value: string | null, names: ReadonlySet<string>): boolean {
  if (value === null || names.size === 0) return false;
  return names.has(value.toLowerCase());
}

function childRunIdFor(parentRunId: string, callId: string): string {
  const digest = createHash("sha256")
    .update(`${parentRunId}:${callId}`)
    .digest("hex")
    .slice(0, 32);
  return `subagent-${digest}`;
}

function lifecycleStatus(status: "running" | "completed" | "error"): SubagentLifecycleDetection["status"] {
  if (status === "completed") return "FINISHED";
  if (status === "error") return "ERROR";
  return "RUNNING";
}

function taskSubagentName(args: unknown): string | null {
  return (
    getStringAt(args, ["subagentType", "name"]) ??
    getStringAt(args, ["subagent_type", "name"]) ??
    getStringAt(args, ["subagent", "name"]) ??
    getStringAt(args, ["subagentType", "kind"]) ??
    getStringAt(args, ["subagent_type", "kind"])
  );
}

export function detectSubagentToolCall(
  raw: Extract<SDKMessage, { type: "tool_call" }>,
  context: { runId: string },
): SubagentLifecycleDetection | null {
  let name: string | null = null;
  if (raw.name === "task") {
    name = taskSubagentName(raw.args);
  } else if (raw.name === "mcp") {
    const provider = getStringAt(raw.args, ["providerIdentifier"]);
    const toolName = getStringAt(raw.args, ["toolName"]);
    if (looksLikeSubagentMcpName(provider, toolName)) {
      name = provider ?? toolName ?? "MCP sub-agent";
    }
  } else if (raw.name.startsWith("mcp__")) {
    const [, provider, toolName] = raw.name.split("__");
    const providerName = provider ?? null;
    const tool = toolName ?? null;
    if (looksLikeSubagentMcpName(providerName, tool)) {
      name = providerName ?? tool ?? "MCP sub-agent";
    }
  }

  if (name === null) return null;
  return {
    childRunId: childRunIdFor(context.runId, raw.call_id),
    name: boundedSubagentName(name),
    status: lifecycleStatus(raw.status),
  };
}

/**
 * Hard cap on how many sub-agent tool-call summaries we extract from a
 * single completed `task` result. A thorough sub-agent can emit dozens of
 * tool calls; we keep a generous ceiling so the lifecycle payload stays
 * small and well under the 256 KiB large-payload threshold.
 */
const MAX_SUBAGENT_TOOL_CALLS = 500;
const DETAIL_MAX_LENGTH = 256;

/**
 * Argument keys, in priority order, that carry the "primary" detail worth
 * showing for a sub-agent tool call (the file read, the pattern grepped,
 * the command run). The Cursor SDK names these inconsistently across tool
 * variants, so we probe several. `args` is `unknown` per the ledger — parse
 * defensively.
 */
const PRIMARY_DETAIL_KEYS = [
  "command",
  "path",
  "filePath",
  "file_path",
  "targetFile",
  "pattern",
  "globPattern",
  "query",
  "url",
  "targetDirectory",
] as const;

/** Keys whose value is a filesystem path — shown as a basename, not in full. */
const PATH_DETAIL_KEYS = new Set<string>(["path", "filePath", "file_path", "targetFile", "targetDirectory"]);

/** Result keys that signal a failed tool call (vs. the `success` variant). */
const FAILURE_RESULT_KEYS = ["error", "permissionDenied", "failure", "rejected", "timeout"];

function toolNameFromVariant(variantKey: string): string {
  const name = variantKey.replace(/ToolCall$/u, "");
  return name.length > 0 ? name : variantKey;
}

function basenameish(value: string): string {
  // Show the trailing path segment for path-like details; leave others as-is.
  if (!value.includes("/")) return value;
  const trimmed = value.replace(/\/+$/u, "");
  const idx = trimmed.lastIndexOf("/");
  const tail = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return tail.length > 0 ? tail : trimmed;
}

function primaryDetail(args: unknown): string {
  if (!isRecord(args)) return "";
  for (const key of PRIMARY_DETAIL_KEYS) {
    const raw = args[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      const trimmed = raw.trim();
      const detail = PATH_DETAIL_KEYS.has(key) ? basenameish(trimmed) : trimmed;
      return detail.slice(0, DETAIL_MAX_LENGTH);
    }
  }
  return "";
}

function toolCallSucceeded(result: unknown): boolean {
  if (!isRecord(result)) return true; // no result shape → assume it ran
  if ("success" in result) return true;
  return !FAILURE_RESULT_KEYS.some((key) => key in result);
}

/**
 * Extract a compact per-tool-call summary from a completed `task` tool
 * result. The transcript lives at `result.value.conversationSteps[]`, where
 * each step is one of `{ thinkingMessage }`, `{ assistantMessage }`, or
 * `{ toolCall: { <name>ToolCall: { args, result } } }`. We keep only the
 * `toolCall` steps. Shapes are SDK-defined and treated as `unknown` (ledger
 * OQ-01/OQ-32) — every access is guarded.
 */
export function extractSubagentToolCalls(result: unknown): SubagentToolCallSummary[] {
  const value = isRecord(result) ? result.value : undefined;
  const steps = isRecord(value) ? value.conversationSteps : undefined;
  if (!Array.isArray(steps)) return [];

  const out: SubagentToolCallSummary[] = [];
  for (const step of steps) {
    if (out.length >= MAX_SUBAGENT_TOOL_CALLS) break;
    if (!isRecord(step)) continue;
    const toolCall = step.toolCall;
    if (!isRecord(toolCall)) continue;
    // The toolCall is a protobuf oneof: exactly one `<name>ToolCall` key.
    const variantKey = Object.keys(toolCall).find((key) => isRecord(toolCall[key]));
    if (variantKey === undefined) continue;
    const variant = toolCall[variantKey] as Record<string, unknown>;
    out.push({
      name: toolNameFromVariant(variantKey),
      detail: primaryDetail(variant.args),
      ok: toolCallSucceeded(variant.result),
    });
  }
  return out;
}

export function detectSubagentSpawn(
  event: CanonicalRunEventDraft,
  options: DetectSubagentSpawnOptions,
): DetectedSubagent | null {
  if (event.kind !== "tool_call.running") return null;
  if (!event.callId) return null;
  if (!isRecord(event.payload)) return null;
  if (stringField(event.payload, "name") !== "mcp") return null;

  const args = isRecord(event.payload.args) ? event.payload.args : null;
  const providerIdentifier = stringField(args, "providerIdentifier");
  const toolName = stringField(args, "toolName");
  if (providerIdentifier === null) return null;

  const configuredNames = new Set(
    (options.configuredSubagentNames ?? []).map((name) => name.toLowerCase()),
  );
  if (
    !looksLikeSubagentName(providerIdentifier) &&
    !looksLikeSubagentName(toolName) &&
    !matchesConfiguredName(providerIdentifier, configuredNames) &&
    !matchesConfiguredName(toolName, configuredNames)
  ) {
    return null;
  }

  return {
    name: boundedSubagentName(providerIdentifier),
    callId: event.callId,
    parentRunId: options.parentRunId,
  };
}
