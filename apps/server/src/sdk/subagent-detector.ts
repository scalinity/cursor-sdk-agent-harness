import { createHash } from "node:crypto";
import type { SDKMessage } from "@harness/shared";
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
