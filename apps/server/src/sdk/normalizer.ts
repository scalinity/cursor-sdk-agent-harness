import type {
  AgentMode,
  EventSdkType,
  SDKMessage,
  ToolUseBlock,
} from "@harness/shared";
import { extractCodeEdit } from "./code-edit-extractors/index.js";

/**
 * Phase 07 — pure normalization from raw SDK message to one or more canonical
 * event drafts. The drafts carry no `seq` and no `event_id`; the
 * persist-and-broadcast pipeline allocates both inside the same DB
 * transaction that inserts the row.
 *
 * The normalizer is intentionally side-effect-free. It owns the
 * delta-vs-snapshot decision for assistant/thinking text by comparing the
 * incoming text against a previously-accumulated buffer supplied via
 * `runContext`. The caller updates the buffer with `textBufferUpdates`
 * after the row commits.
 *
 * See spec §4 "Event Normalization Pipeline" + §7 "Domain Schemas" for the
 * authoritative event shapes, and SDK_VERIFICATION_LEDGER.md OQ-06..OQ-09
 * for the SDK-side behaviour these conversions defend against.
 */

export interface RunContext {
  runId: string;
  agentId: string;
  /**
   * Execution mode of the owning agent. Threaded through from the
   * agents row so `system.init` payloads carry the actual mode rather
   * than a hardcoded literal — cloud-mode agents flow through the same
   * sink and would otherwise be misclassified at persistence + replay.
   */
  agentMode: AgentMode;
  /** ISO timestamp the harness assigned when it received the SDK message. */
  receivedAt: string;
  /**
   * ISO timestamp the SDK reports for when the event happened. The SDK
   * doesn't expose this today, so callers default to `receivedAt`.
   */
  occurredAt: string;
  /** Accumulated assistant text observed so far for this run. */
  previousAssistantText: string;
  /** Accumulated thinking text observed so far for this run. */
  previousThinkingText: string;
}

export interface NormalizeInput {
  raw: SDKMessage;
  runContext: RunContext;
}

export interface CanonicalRunEventDraft {
  sdkType: EventSdkType;
  kind: string;
  callId: string | null;
  requestId: string | null;
  status: string | null;
  payload: unknown;
  raw: unknown;
  occurredAt: string;
  receivedAt: string;
}

export interface TextBufferUpdates {
  assistantText?: string;
  thinkingText?: string;
}

export interface NormalizeOutput {
  events: CanonicalRunEventDraft[];
  textBufferUpdates: TextBufferUpdates;
}

/**
 * Phase 10 — completed edit-like tool calls are inspected by server-side
 * extractors. A successful parse emits a derived `code_edit.detected` event;
 * non-matching shapes simply leave the raw tool call visible.
 */

export function normalize(input: NormalizeInput): NormalizeOutput {
  const { raw, runContext } = input;
  const events: CanonicalRunEventDraft[] = [];
  const textBufferUpdates: TextBufferUpdates = {};

  switch (raw.type) {
    case "system": {
      events.push({
        sdkType: "system",
        kind: "system.init",
        callId: null,
        requestId: null,
        status: null,
        payload: {
          ...(raw.subtype !== undefined ? { subtype: raw.subtype } : {}),
          ...(raw.model !== undefined ? { model: raw.model } : {}),
          ...(raw.tools !== undefined ? { tools: raw.tools } : {}),
          // `mode` is non-optional on the wire schema but the SDK doesn't
          // expose it on the system message — use the agent's persisted mode.
          // Both local and cloud agents flow through this sink; hardcoding
          // would mis-tag cloud runs in replay.
          mode: runContext.agentMode,
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      break;
    }

    case "user": {
      events.push({
        sdkType: "user",
        kind: "user.message",
        callId: null,
        requestId: null,
        status: null,
        payload: {
          role: "user" as const,
          content: raw.message.content.map((c) => ({
            type: "text" as const,
            text: c.text,
          })),
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      break;
    }

    case "assistant": {
      const fullText = extractAssistantText(raw.message.content);
      const toolUses = extractToolUses(raw.message.content);
      const derived = deriveTextMode(runContext.previousAssistantText, fullText, {
        deltaKind: "assistant.delta",
        snapshotKind: "assistant.snapshot",
      });
      events.push({
        sdkType: "assistant",
        kind: derived.kind,
        callId: null,
        requestId: null,
        status: null,
        payload: {
          role: "assistant" as const,
          ...(derived.textDelta !== null ? { text_delta: derived.textDelta } : {}),
          full_text_length: derived.fullTextLength,
          is_replacement: derived.isReplacement,
          tool_uses: toolUses,
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      textBufferUpdates.assistantText = derived.newBufferText;
      break;
    }

    case "thinking": {
      const derived = deriveTextMode(runContext.previousThinkingText, raw.text, {
        deltaKind: "thinking.delta",
        snapshotKind: "thinking.snapshot",
      });
      events.push({
        sdkType: "thinking",
        kind: derived.kind,
        callId: null,
        requestId: null,
        status: null,
        payload: {
          text_delta: derived.textDelta ?? "",
          full_text_length: derived.fullTextLength,
          is_replacement: derived.isReplacement,
          ...(raw.thinking_duration_ms !== undefined
            ? { thinking_duration_ms: raw.thinking_duration_ms }
            : {}),
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      textBufferUpdates.thinkingText = derived.newBufferText;
      break;
    }

    case "tool_call": {
      const kind: "tool_call.running" | "tool_call.completed" | "tool_call.error" =
        raw.status === "completed"
          ? "tool_call.completed"
          : raw.status === "error"
            ? "tool_call.error"
            : "tool_call.running";
      const payload: Record<string, unknown> = {
        call_id: raw.call_id,
        name: raw.name,
        status: raw.status,
        ...(raw.args !== undefined ? { args: raw.args } : {}),
        ...(raw.result !== undefined ? { result: raw.result } : {}),
        ...(raw.truncated !== undefined ? { truncated: raw.truncated } : {}),
      };
      events.push({
        sdkType: "tool_call",
        kind,
        callId: raw.call_id,
        requestId: null,
        status: raw.status,
        payload,
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });

      const derivedCodeEdit =
        raw.status === "completed"
          ? extractCodeEdit({
              callId: raw.call_id,
              name: raw.name,
              args: raw.args,
              result: raw.result,
              ...(raw.truncated !== undefined ? { truncated: raw.truncated } : {}),
            })
          : null;
      if (derivedCodeEdit !== null) {
        events.push({
          sdkType: "tool_call",
          kind: "code_edit.detected",
          callId: raw.call_id,
          requestId: null,
          status: null,
          payload: derivedCodeEdit,
          raw: null,
          occurredAt: runContext.occurredAt,
          receivedAt: runContext.receivedAt,
        });
      }
      break;
    }

    case "status": {
      events.push({
        sdkType: "status",
        kind: "status.changed",
        callId: null,
        requestId: null,
        status: raw.status,
        payload: {
          status: raw.status,
          ...(raw.message !== undefined ? { message: raw.message } : {}),
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      break;
    }

    case "task": {
      events.push({
        sdkType: "task",
        kind: "task.updated",
        callId: null,
        requestId: null,
        status: raw.status ?? null,
        payload: {
          ...(raw.status !== undefined ? { status: raw.status } : {}),
          ...(raw.text !== undefined ? { text: raw.text } : {}),
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      break;
    }

    case "request": {
      events.push({
        sdkType: "request",
        kind: "request.created",
        callId: null,
        requestId: raw.request_id,
        status: null,
        payload: {
          request_id: raw.request_id,
          // OQ-09: SDK ships no contextual hints with `request`. The harness
          // will infer context from surrounding events at render time; the
          // canonical event records only what we know now.
          context_event_ids: [],
          inferred_reason: null,
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      break;
    }
  }

  return { events, textBufferUpdates };
}

function extractAssistantText(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  let out = "";
  for (const c of content) {
    if (c.type === "text" && typeof c.text === "string") {
      out += c.text;
    }
  }
  return out;
}

function extractToolUses(
  content: ReadonlyArray<unknown>,
): Array<{ id: string; name: string; input: unknown }> {
  const out: Array<{ id: string; name: string; input: unknown }> = [];
  for (const c of content) {
    if (
      c !== null &&
      typeof c === "object" &&
      (c as { type?: unknown }).type === "tool_use"
    ) {
      const tu = c as ToolUseBlock;
      out.push({ id: tu.id, name: tu.name, input: tu.input });
    }
  }
  return out;
}

interface DerivedTextMode {
  kind: string;
  /** Suffix when delta, full text when snapshot, null when text is empty. */
  textDelta: string | null;
  isReplacement: boolean;
  fullTextLength: number;
  /**
   * F-005: text the caller should write back into the run-buffer so the
   * NEXT message's `previous` reflects the cumulative text. The old code
   * unconditionally overwrote the buffer with `fullText`, which truncated
   * earlier text whenever the SDK sent per-message deltas (which it does
   * — OQ-06 confirmed against @cursor/sdk@1.0.13).
   */
  newBufferText: string;
}

function deriveTextMode(
  previous: string,
  current: string,
  kinds: { deltaKind: string; snapshotKind: string },
): DerivedTextMode {
  const _snapshotKind = kinds.snapshotKind;
  void _snapshotKind; // kept in the API for callers that still reference it
  if (current.length === 0) {
    return {
      kind: kinds.deltaKind,
      textDelta: null,
      isReplacement: false,
      fullTextLength: previous.length,
      newBufferText: previous,
    };
  }
  if (previous.length === 0) {
    return {
      kind: kinds.deltaKind,
      textDelta: current,
      isReplacement: false,
      fullTextLength: current.length,
      newBufferText: current,
    };
  }
  // Cumulative-snapshot SDKs send "HEL" then "HELLO"; the suffix is the
  // real new content.
  if (current.startsWith(previous)) {
    const delta = current.slice(previous.length);
    return {
      kind: kinds.deltaKind,
      textDelta: delta,
      isReplacement: false,
      fullTextLength: current.length,
      newBufferText: current,
    };
  }
  // F-005 / OQ-06: @cursor/sdk@1.0.13 sends per-message deltas. The
  // previous code treated this case as a snapshot-replacement, which
  // silently dropped earlier text ("HEL" + "LO" rendered as "LO"
  // instead of "HELLO"). Append instead — both this run's text and
  // the cumulative buffer.
  const merged = previous + current;
  return {
    kind: kinds.deltaKind,
    textDelta: current,
    isReplacement: false,
    fullTextLength: merged.length,
    newBufferText: merged,
  };
}
