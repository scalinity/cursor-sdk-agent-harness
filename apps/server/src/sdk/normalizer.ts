import type {
  EventSdkType,
  SDKMessage,
  ToolUseBlock,
} from "@harness/shared";

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
 * Tool names whose `tool_call.completed` event should produce a placeholder
 * `code_edit.detected` derived event. Phase 10 implements the actual extractor
 * that fills in `edits`; Phase 07 only emits the seam so replay can hide
 * tool-call cards behind the preview UI consistently.
 *
 * Verified literals from OQ-08 in the ledger.
 */
const CODE_EDIT_TOOL_NAMES = new Set(["edit", "write", "delete"]);

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
          // expose it on the system message — default to "local" since cloud
          // execution would have flowed through a different code path.
          mode: "local",
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
      const { kind, textDelta, isReplacement, fullTextLength } =
        deriveTextMode(runContext.previousAssistantText, fullText, {
          deltaKind: "assistant.delta",
          snapshotKind: "assistant.snapshot",
        });
      events.push({
        sdkType: "assistant",
        kind,
        callId: null,
        requestId: null,
        status: null,
        payload: {
          role: "assistant" as const,
          ...(textDelta !== null ? { text_delta: textDelta } : {}),
          full_text_length: fullTextLength,
          is_replacement: isReplacement,
          tool_uses: toolUses,
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      textBufferUpdates.assistantText = fullText;
      break;
    }

    case "thinking": {
      const { kind, textDelta, isReplacement, fullTextLength } =
        deriveTextMode(runContext.previousThinkingText, raw.text, {
          deltaKind: "thinking.delta",
          snapshotKind: "thinking.snapshot",
        });
      events.push({
        sdkType: "thinking",
        kind,
        callId: null,
        requestId: null,
        status: null,
        payload: {
          // Wire schema requires text_delta; for a snapshot we send the full
          // text and set is_replacement true so the client clears its buffer.
          text_delta: textDelta ?? "",
          full_text_length: fullTextLength,
          is_replacement: isReplacement,
          ...(raw.thinking_duration_ms !== undefined
            ? { thinking_duration_ms: raw.thinking_duration_ms }
            : {}),
        },
        raw,
        occurredAt: runContext.occurredAt,
        receivedAt: runContext.receivedAt,
      });
      textBufferUpdates.thinkingText = raw.text;
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

      // Derived `code_edit.detected` placeholder. Phase 10 will populate
      // `edits` from `result.value.diffString` (edit), `args.fileText`
      // (write), or `args.path` (delete). For now the placeholder is enough
      // to wire the UI seam without committing to extraction shape.
      if (
        raw.status === "completed" &&
        CODE_EDIT_TOOL_NAMES.has(raw.name)
      ) {
        events.push({
          sdkType: "tool_call",
          kind: "code_edit.detected",
          callId: raw.call_id,
          requestId: null,
          status: null,
          payload: {
            source_call_id: raw.call_id,
            confidence: "low" as const,
            edits: [],
          },
          // Derived events carry no raw payload of their own — they reference
          // the source call via `source_call_id`.
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
}

function deriveTextMode(
  previous: string,
  current: string,
  kinds: { deltaKind: string; snapshotKind: string },
): DerivedTextMode {
  const fullTextLength = current.length;
  if (current.length === 0) {
    // Empty payload — treat as a delta of zero length. This preserves the
    // event in the timeline without claiming the buffer was replaced.
    return {
      kind: kinds.deltaKind,
      textDelta: null,
      isReplacement: false,
      fullTextLength,
    };
  }
  // Prefix-match: the SDK never explicitly states whether assistant/thinking
  // payloads are deltas or cumulative snapshots (OQ-06). If `current` starts
  // with `previous`, treat the new content as the suffix — that's the safe
  // append. Otherwise the SDK has rewritten the buffer (e.g. revised an
  // earlier assistant block); emit a snapshot and let the client replace.
  if (previous.length > 0 && current.startsWith(previous)) {
    const delta = current.slice(previous.length);
    return {
      kind: kinds.deltaKind,
      textDelta: delta,
      isReplacement: false,
      fullTextLength,
    };
  }
  if (previous.length === 0) {
    // First text observed for the run — emit it as a delta of the whole
    // string. This matches `is_replacement: false` because there's nothing
    // to replace yet.
    return {
      kind: kinds.deltaKind,
      textDelta: current,
      isReplacement: false,
      fullTextLength,
    };
  }
  return {
    kind: kinds.snapshotKind,
    textDelta: current,
    isReplacement: true,
    fullTextLength,
  };
}
