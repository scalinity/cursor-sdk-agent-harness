# SDK Verification Ledger

Phase 01 output — resolves every Open Question from `spec-v1.1.md` Section 14 against
`@cursor/sdk@1.0.13` declarations and the official Cursor documentation.

- **SDK under test**: `@cursor/sdk@1.0.13` (latest published at time of this ledger).
- **TypeScript declarations root**: `node_modules/@cursor/sdk/dist/esm/`.
- **Doc source of record**: <https://cursor.com/docs/sdk/typescript> (fetched via WebFetch),
  <https://cursor.com/blog/typescript-sdk>, <https://cursor.com/blog/agent-sandboxing>,
  <https://cursor.com/docs/hooks>.
- **Citation convention**: `path/to/file.d.ts:lineFirst-lineLast` refers to the
  inspected SDK declaration file from the temporary `verification/` workspace.
  File-relative paths point to `verification/node_modules/@cursor/sdk/dist/esm/<file>`.
  The `verification/` workspace is torn down after this phase — re-run
  `pnpm add @cursor/sdk@1.0.13` to reproduce.
- **Confidence labels**: `verified` (grounded in declarations or first-party docs),
  `partial` (declarations consistent with claim but a runtime confirmation is still
  needed), `unverified` (cannot be answered without a runtime smoke test).

> **Cancellation strategy chosen (Phase 13 prerequisite)**: `Run.cancel()` is the
> sole supported primitive. `AbortSignal` is not accepted by `agent.send()` in
> v1.0.13. The harness MUST NOT pass `{ signal }` and MUST gate cancellation on
> `Run.supports("cancel")` before invoking `await run.cancel()`. See OQ-11–OQ-13.

> **Streaming markdown package chosen (Phase 09 prerequisite)**:
> `streaming-markdown@^0.2.15` (`smd` API). See OQ-21.

> **Lezer parser packages chosen (Phase 10 prerequisite)**:
> `@lezer/javascript` (with `"ts"` dialect for TypeScript), `@lezer/python`,
> `@lezer/json`, `@lezer/markdown`, `@lezer/highlight`, `@lezer/common`, plus
> `@codemirror/legacy-modes/mode/shell` for shell. Plain text is rendered without
> a parser. See OQ-22.

---

## OQ-01: Does prompt caching expose any SDK-visible metadata or controls?

- **Status**: partial
- **Answer**: There is no SDK-visible *control* for caching — caching is purely
  server-side and automatic. There IS SDK-visible *metadata* in the form of
  `cacheReadTokens` and `cacheWriteTokens` on the `TurnEndedUpdate.usage` delta
  event, which is only delivered through the `SendOptions.onDelta` callback
  (not through `stream()` and not on `RunResult`). No `cacheControl`,
  `enableCache`, `cacheTtl`, or similar configuration field exists on
  `AgentOptions`, `SendOptions`, or `CloudAgentOptions`.
- **Citation**:
  - `agent.d.ts:19-43` (`SendOptions` — no cache fields, `onDelta` is the
    delta hook).
  - `options.d.ts:122-144` (`AgentOptions` — no cache fields).
  - Official docs (Cursor TypeScript SDK reference, fetched via WebFetch from
    `https://cursor.com/docs/sdk/typescript`): "cache_read/cache_write tokens
    appear in `TurnEndedUpdate.usage` but no caching configuration is exposed."
  - Internal protobuf evidence (`dist/esm/index.js` bundle, grep:
    `cache_read_tokens`, `cache_write_tokens` field names with `kind:"scalar"`).
- **Implication for downstream phases**: Phase 04 / Phase 11 (usage extraction +
  pricing) must take cache counters from `onDelta(TurnEndedUpdate)`, not from
  `RunResult`. The harness has no way to opt in/out of caching — pricing settings
  treat the cache split as descriptive only. See OQ-02, OQ-03, OQ-04.

---

## OQ-02: Does `run.wait()` final result expose token/usage metadata? In what shape?

- **Status**: verified (negative result)
- **Answer**: No. `RunResult` exposes only `{ id, status, result?, model?,
  durationMs?, git? }`. There is no `usage`, `tokens`, `inputTokens`,
  `outputTokens`, or any token/cost field on the result returned by
  `run.wait()`. Authoritative usage is delivered exclusively through the
  `onDelta(TurnEndedUpdate.usage)` callback during streaming.
- **Citation**:
  - `run.d.ts:19-26` — full `RunResult` interface:
    ```ts
    export interface RunResult {
      id: string;
      status: RunResultStatus;
      result?: string;
      model?: ModelSelection;
      durationMs?: number;
      git?: RunGitInfo;
    }
    ```
  - `verification/typecheck.ts:33-39` — `@ts-expect-error` probe confirms
    `RunResult.usage` does not exist; future SDK versions adding it will fail
    typecheck and force re-verification.
- **Implication for downstream phases**: Phase 04 usage-extractor must NOT
  attempt to read `usage` from the `run.wait()` result. The single source of
  truth for tokens is the `TurnEndedUpdate.usage` payload accumulated during
  the stream. `runs.usage_source = "sdk_final_result"` should be renamed
  conceptually to "sdk_turn_ended" — the column value can stay as a literal
  but its meaning is the last `turn-ended` event for the run, not the
  `run.wait()` result. See OQ-03, Phase 11.

---

## OQ-03: Does any stream event carry incremental usage?

- **Status**: verified
- **Answer**: Yes, but not on `Run.stream()` (`AsyncGenerator<SDKMessage>`).
  Usage rides on the `TurnEndedUpdate` delta event delivered through
  `SendOptions.onDelta`. None of the `SDKMessage` variants (`system`, `user`,
  `assistant`, `tool_call`, `thinking`, `status`, `request`, `task`) carry
  token fields. Per-turn usage is therefore *post-turn*, not truly intra-turn
  incremental — the value lands when the assistant turn closes.
- **Citation**:
  - `messages.d.ts:15-82` — full `SDKMessage` union; no `usage`/`tokens`
    fields on any variant.
  - `agent.d.ts:25-27` — `SendOptions.onDelta(args: { update: InteractionUpdate })`.
  - `index.d.ts:12` — exported delta type list includes `TurnEndedUpdate`,
    `TokenDeltaUpdate`, `TextDeltaUpdate`, `ThinkingDeltaUpdate`,
    `ToolCallStartedUpdate`, `ToolCallCompletedUpdate`, etc.
  - Official docs sample (fetched WebFetch):
    ```ts
    interface TurnEndedUpdate {
      type: "turn-ended";
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
      };
    }
    ```
  - Bundled JS discriminator literals (grep): `"turn-ended"`, `"token-delta"`,
    `"text-delta"`, `"thinking-delta"`, `"tool-call-started"`,
    `"tool-call-completed"`, `"partial-tool-call"`, `"shell-output-delta"`,
    `"summary-started"`, `"summary-completed"`, `"user-message-appended"`.
- **Implication for downstream phases**: Phase 04 normalization pipeline must
  subscribe to `onDelta` in addition to iterating `run.stream()`. The
  CostBadge "running estimate" feature (spec §4 Usage and Cost Extraction
  Policy) becomes feasible because `turn-ended` events fire at every turn
  boundary, not just once at the end. Use a multi-turn run to display
  cumulative usage; do not attempt sub-turn estimates.

---

## OQ-04: Does the SDK distinguish cached vs fresh input tokens?

- **Status**: verified
- **Answer**: Yes. The `TurnEndedUpdate.usage` object carries `cacheReadTokens`
  AND `cacheWriteTokens` separately from `inputTokens`. Per the documented
  shape, `inputTokens` is the total input including cached, with `cacheReadTokens`
  being the cached portion (server-cache hit) and `cacheWriteTokens` being the
  newly-cached portion. The split needed for the spec's cost formula
  (`freshInputTokens = inputTokens - cachedInputTokens`) maps directly:
  `cachedInputTokens := cacheReadTokens`.
- **Citation**:
  - Official docs (WebFetch): `TurnEndedUpdate.usage = { inputTokens,
    outputTokens, cacheReadTokens, cacheWriteTokens }`.
  - Internal protobuf field list in bundled JS (`dist/esm/index.js`): protobuf
    messages with `input_tokens`, `output_tokens`, `cache_read_tokens`,
    `cache_write_tokens` all present as `kind:"scalar"` fields.
- **Implication for downstream phases**: Phase 04 / Phase 11: the spec's
  `RunUsage.cached_input_tokens` populates from `cacheReadTokens`.
  `cacheWriteTokens` is currently not used in cost math (no separate price tier
  observed); persist it for analytics/future pricing tiers. Confirm the meaning
  of `inputTokens` (total vs fresh-only) with a smoke run before shipping
  pricing math — if `inputTokens` excludes cached, then `freshInputTokens =
  inputTokens` and the formula simplifies.

---

## OQ-05: Are reasoning tokens reported separately?

- **Status**: unverified
- **Answer**: Not in declarations or documented usage shape. Internal protobuf
  has a `"reasoning"` content kind (i.e. the reasoning *text* is a separate
  content variant alongside `text`), but the public `TurnEndedUpdate.usage`
  object exposes only `inputTokens`, `outputTokens`, `cacheReadTokens`,
  `cacheWriteTokens`. There is no `reasoningTokens` or `thoughtsTokens` field
  visible. Whether reasoning tokens are baked into `outputTokens` or simply
  not counted toward billing is unknown without a smoke run against a model
  that performs visible thinking (e.g. Composer 2 with extended thinking).
- **Citation**:
  - Official docs (WebFetch summary): "Reasoning tokens not mentioned in SDK
    reference."
  - Bundled JS grep (`dist/esm/index.js`): no `"reasoning_tokens"` or
    `"reasoningTokens"` literal found; `"reasoning"` appears only as a content
    discriminator (e.g. `[Thinking] ${e.text}` formatting).
- **Implication for downstream phases**: Persist `reasoning_tokens = NULL`
  until a Phase 11/Phase 14 smoke run confirms billing semantics. Display
  thinking text via the `thinking-delta` delta updates and the
  `SDKThinkingMessage` snapshots, but DO NOT cost reasoning until verified.
  This matches spec §11 "Reasoning token field present but billing semantics
  unknown → reasoning_tokens persists, UI displays separately and excludes
  from cost until verified."

---

## OQ-06: Are `assistant` and `thinking` stream payloads deltas or snapshots?

- **Status**: verified — per-message deltas
- **Verified by**: Phase 15 live smoke against `@cursor/sdk@1.0.13`
  (F-005). A two-character prompt "Reply HELLO" produced two raw
  `assistant` messages: `{content: [{text: "HEL"}]}` then
  `{content: [{text: "LO"}]}`. The harness's prefix-match path treated
  the second as a snapshot replacement and rendered "LO" instead of
  "HELLO". The normalizer now appends on the non-prefix branch
  (`apps/server/src/sdk/normalizer.ts`, F-005 commit 3005eb4) and
  matches the SDK's actual contract.
- **Legacy partial answer (kept for historical context)**:
- **Answer**: Two parallel streams exist, with different semantics:
  1. `run.stream()` yields `SDKMessage` events. `SDKAssistantMessage.message
     .content` is an array of `TextBlock | ToolUseBlock`. The presence of
     `accumulateSdkMessageStream(stream)` and `sdkMessageToInteractionUpdate`
     helper functions strongly indicates each yielded message is a per-event
     payload that the SDK itself converts into a delta. In other words,
     `SDKMessage` events are **per-event chunks** (closer to deltas than to
     cumulative snapshots), but the SDK does not state the contract
     explicitly.
  2. `SendOptions.onDelta(update: InteractionUpdate)` provides explicit deltas
     keyed by literal types: `"text-delta"`, `"thinking-delta"`,
     `"tool-call-started"`, `"tool-call-completed"`, `"partial-tool-call"`,
     `"shell-output-delta"`, `"turn-ended"`, etc.
  The spec's "normalize as append-only delta" strategy (spec §4 Assistant and
  Thinking Delta Policy) is the correct defensive approach because the
  on-the-wire shape via `stream()` is not contractually defined.
- **Citation**:
  - `messages.d.ts:23-31` (`SDKAssistantMessage.message.content` shape).
  - `run-interaction-accumulator.d.ts:18-32` — `accumulateSdkMessageStream`
    and `sdkMessageToInteractionUpdate` utilities.
  - `index.d.ts:12-13` — full delta-update type list.
  - Official docs do not specify whether assistant content is delta or
    snapshot.
- **Implication for downstream phases**: Phase 04 normalizer must keep the
  prefix-match delta strategy from spec §4 (compare new text against
  accumulated text; emit suffix-only delta if prefix matches, else emit
  `is_replacement = true`). Alternatively, the harness can subscribe to
  `onDelta` directly and bypass the inference logic. Phase 09 prefers
  `onDelta` because the delta semantics are explicit and the markdown
  parser only needs append-only text.

---

## OQ-07: What exact built-in tool names appear for Explore, Bash, and Browser?

- **Status**: partial
- **Answer**: There are two distinct surfaces:
  1. **Primitive tool calls** appear as `SDKToolUseMessage.name` with these
     verified literal values (extracted from `conversation-types.d.ts` Zod
     discriminated unions): `shell`, `write`, `delete`, `glob`, `grep`,
     `read`, `edit`, `ls`, `readLints`, `mcp`, `generateImage`,
     `recordScreen`, `semSearch`, `createPlan`, `task`, `updateTodos`.
     "Bash" in the spec maps to the `shell` primitive tool (the SDK's
     internal protobuf shell-type enum uses `SHELL_TYPE_BASH`).
  2. **Subagent invocations** are encoded as the `task` tool with
     `args.subagentType.kind: string`. From the protobuf oneof in the
     bundled JS (`agent.v1.SubagentType`), the valid kind literals are:
     `unspecified`, `computer_use`, `custom`, `explore`, `media_review`,
     `bash`, `browser_use`, `shell`, `vm_setup_helper`, `debug`,
     `cursor_guide`, `watch_video`. So "Explore" → `"explore"`, "Browser"
     → `"browser_use"`, "Bash" subagent → `"bash"` (distinct from the
     primitive `shell` tool).
  Official docs warn (WebFetch): "Tool names can also be renamed or
  replaced. Treat `args` and `result` as `unknown` and parse defensively."
  So the literals are verified for v1.0.13 but treated as soft contract.
- **Citation**:
  - `messages.d.ts:41-54` — `SDKToolUseMessage.name: string`.
  - `types/conversation-types.d.ts` (extracted via grep,
    `type: z.ZodLiteral<"...">`): primitive tool literals listed above.
  - `dist/esm/index.js` (protobuf grep): `agent.v1.SubagentType` oneof has
    fields `unspecified`, `computer_use`, `custom`, `explore`,
    `media_review`, `bash`, `browser_use`, `shell`, `vm_setup_helper`,
    `debug`, `cursor_guide`, `watch_video`.
  - Official docs (WebFetch): tool names unstable, treat defensively.
- **Implication for downstream phases**: Phase 09 ToolCallCard renderer uses
  `SDKToolUseMessage.name` as the primary discriminator, with the literal
  list above as the **icon/title lookup** but the underlying parser must
  fall back to a generic JSON renderer for unknown names. For subagent
  cards, parse `task` args defensively: read `args.subagentType?.kind`
  with a soft mapping table to icons. Document the mapping in
  `packages/shared/src/tool-names.ts` as the spec evolves.

---

## OQ-08: What shapes do code-edit tool args/results use?

- **Status**: verified
- **Answer**:
  - `edit` tool — `args: { path: string }` (the diff itself is NOT in args,
    only the path). `result.value: { linesAdded?: number; linesRemoved?:
    number; diffString?: string }`. The `diffString` is the source of truth
    for `CodeEditPreview`.
  - `write` tool — `args: { path: string; fileText: string;
    returnFileContentAfterWrite?: boolean }`. `result.value: { path: string;
    linesCreated: number; fileSize: number; fileContentAfterWrite?: string
    }`.
  - `delete` tool — `args: { path: string }`. `result.value: { fileSize:
    number }`.
  - All three follow the discriminated-union result shape `{ status:
    "success", value: ... } | { status: "error", error: any }`.
  - The transport may set `SDKToolUseMessage.truncated.args === true` or
    `truncated.result === true` when payloads are clipped (see
    `messages.d.ts:50-53`).
- **Citation**:
  - `types/conversation-types.d.ts:175-270` — `write` tool args/result.
  - `types/conversation-types.d.ts:272-336` — `delete` tool args/result.
  - `types/conversation-types.d.ts:1242-1320` — `edit` tool args/result.
  - `tool-call-utils.d.ts:1-7` — `ToolPayloadTruncated` shape.
- **Implication for downstream phases**: Phase 09 `CodeEditPreview` extracts
  the diff from `edit.result.value.diffString` (unified-diff text), not from
  `edit.args`. For `write` it extracts the new content from `args.fileText`
  and reports line count from `result.value.linesCreated`. For `delete` it
  shows the deleted path with the freed size from `result.value.fileSize`.
  All extractors must short-circuit when `tool_call.truncated.{args,result}`
  is set and surface a "payload truncated, fetch full JSON" affordance.

---

## OQ-09: What is the exact `request` event payload beyond `request_id`?

- **Status**: verified (sparse)
- **Answer**: Nothing beyond the common envelope. `SDKRequestMessage` is:
  ```ts
  { type: "request"; agent_id: string; run_id: string; request_id: string }
  ```
  There is no `reason`, `tool`, `prompt`, `payload`, `context`, or any other
  field on the request event. The harness must infer human-readable context
  from the surrounding stream (nearest preceding `tool_call.running`, nearest
  preceding `task`, current run status), exactly as spec §4
  Approval Flow already specifies.
- **Citation**:
  - `messages.d.ts:69-74` — `SDKRequestMessage` interface.
- **Implication for downstream phases**: Phase 09 ApprovalPrompt UI must NOT
  expect any payload from `request`. The `RequestCreatedPayload` shape
  (`{ request_id, context_event_ids[], inferred_reason }`) is a harness
  invention populated by reading nearby canonical events at normalization
  time. Persist `request_id` immediately so reconnect replay can re-render
  the prompt with the same inferred context.

---

## OQ-10: What SDK method resolves a `request` approval/denial?

- **Status**: unverified — almost certainly *unavailable* in v1.0.13
- **Answer**: No public SDK method resolves `request` events.
  - There is no `.respond()`, `.resolve()`, `.approve()`, `.deny()`, or
    `.reply()` method on `Run`, `SDKAgent`, or the static `Agent` class.
  - The bundled JS contains no `respondToRequest`, `resolveRequest`,
    `approveRequest`, or `approval_response` literal.
  - The control surface that *does* exist is `.cursor/hooks.json` —
    `beforeShellExecution`, `beforeMCPExecution`, `preToolUse`, etc. —
    which are external scripts that gate actions BEFORE they reach the
    `request` event surface. Hooks return `{ permission: "allow" | "deny"
    | "ask" }` and are not callable from within the SDK process.
  - Sandboxing (`local.sandboxOptions.enabled: true`) emits `request`
    events when the agent needs to step outside the sandbox (e.g. network
    access). The escalation path that the Cursor desktop client uses is
    not exposed through the SDK; resolution likely happens via the hooks
    surface or via a private RPC the desktop client uses.
- **Citation**:
  - `run.d.ts:27-43` (`Run` interface — no respond method).
  - `stubs.d.ts:35-73` (`Agent` static class — no respond method).
  - `agent.d.ts:5-18` (`SDKAgent` interface — no respond method).
  - Official docs (WebFetch summary): "No resolution method documented."
  - <https://cursor.com/docs/hooks> — hooks return permission decisions
    out-of-band.
- **Implication for downstream phases**: Phase 12 (Approval flow) ships in
  the spec's "Partial" form: the harness defines the canonical
  `ApprovalResponder` interface, persists user decisions, but the actual
  `ApprovalResponder.resolve(...)` body returns `CANCEL_UNAVAILABLE` (rename
  to `APPROVAL_UNAVAILABLE`) and the UI shows "Approval not supported by
  current SDK". Phase 12 also writes a single integration test that ensures
  no code path silently fakes a resolved request. Re-check this OQ when
  `@cursor/sdk` bumps minor versions — when a method appears, the harness
  flips approval from Partial to Verified without protocol changes.
- **Phase 13 resolution (2026-05-23)**: The harness shipped a
  probe-based `ApprovalResponder` (`apps/server/src/sdk/approval-responder.ts`).
  At first `approval_response` from the client, the probe enumerates
  candidate method names (`respond`, `approve`, `respondToRequest`,
  `resolveRequest`) against the live `Run` handle. None exist in
  `@cursor/sdk@1.0.13` — the responder throws
  `UnimplementedApprovalError` and the WS plugin emits an
  `approval.failed` canonical event with `code =
  "APPROVAL_UNIMPLEMENTED"`. The UI surfaces a non-dismissable banner
  in the inline `ApprovalPrompt`. No code path silently fakes
  resolution. Status remains **unverified-negative**; re-check on
  every SDK bump.

---

## OQ-11: Does `agent.send(prompt, opts)` accept `{ signal: AbortSignal }`?

- **Status**: verified (negative)
- **Answer**: No. `SendOptions` does not contain a `signal` field. The
  `@ts-expect-error` probe in `verification/typecheck.ts:21-26` confirms
  that passing `{ signal: new AbortController().signal }` fails typecheck.
- **Citation**:
  - `agent.d.ts:19-43` — full `SendOptions` interface; no `signal`.
  - `verification/typecheck.ts:21-26` — typecheck probe asserting absence.
  - Official docs (WebFetch summary): "Not documented. The `agent.send()`
    signature shows no `AbortSignal` parameter. Cancellation uses
    `await run.cancel()` instead."
- **Implication for downstream phases**: Phase 04 Run lifecycle code must
  follow the spec's fallback branch (spec §4 step 5, §11 cancellation
  contract step 8) immediately — there is no overload to attempt. The
  `RunController` will create an internal `AbortController` only for
  server-side task coordination (e.g. detaching the stream-reader task,
  cancelling timers) and NEVER pass it to `agent.send`. See OQ-12 for the
  cancellation primitive that IS available.

---

## OQ-12: Does `Run` expose a `cancel()` method?

- **Status**: verified
- **Answer**: Yes. `Run.cancel(): Promise<void>` is a documented method.
  Additionally, `Run.supports("cancel"): boolean` lets the harness verify
  the operation is available before invoking it, and `Run.unsupportedReason(
  operation)` provides a human-readable reason if not.
  The static `Agent.cancelRun(runId, options?)` also exists as an alternate
  entry point (useful when the harness has lost the `Run` object — e.g.
  after a server restart — but knows the `runId`).
- **Citation**:
  - `run.d.ts:30-31, 35` — `supports`, `unsupportedReason`, `cancel`.
  - `stubs.d.ts:52` — `Agent.cancelRun(runId, options?: GetRunOptions):
    Promise<void>`.
  - `verification/typecheck.ts:7-10` — typecheck probe confirming
    `run.cancel(): Promise<void>`.
  - Official docs (WebFetch): "`await run.cancel()` — Status moves to
    `'cancelled'`, the live stream aborts, in-flight tool calls stop, and
    `run.wait()` resolves with `status: 'cancelled'`. Partial output stays
    on the Run object."
- **Implication for downstream phases**: Phase 13 cancellation contract is
  straightforward — call `run.cancel()` (or `Agent.cancelRun(runId)` after
  process restart) and rely on the SDK to transition the run to
  `cancelled`. The `CANCEL_UNAVAILABLE` branch from spec §11 is only
  reachable if `Run.supports("cancel")` returns `false`, which has not
  been observed in v1.0.13 — keep the branch in code but expect it to be
  dead code unless the SDK regresses.

---

## OQ-13: What status does a successfully cancelled run report?

- **Status**: verified
- **Answer**: `cancelled` (lowercase) on the `Run.status` and
  `RunResult.status` surface. On `SDKStatusMessage.status`, the literal
  is uppercase: `"CANCELLED"`. The normalizer must canonicalize both to
  the harness's `CANCELLED` enum, but persistence MUST distinguish:
  - `run.status === "cancelled"` AND/OR an `SDKStatusMessage` with status
    `"CANCELLED"` arrives → harness sets `runs.status = "CANCELLED"`,
    `interrupted_reason = "user_cancelled"`.
  - Run errors after a cancel attempt → harness sets
    `runs.status = "ERROR"`, `interrupted_reason = "cancel_failed"`. Never
    classify a user-initiated abort as `ERROR` unless cancellation itself
    threw.
  Per docs, `run.wait()` resolves with `RunResult { status: "cancelled"
  }` after a successful cancel — it does NOT throw.
- **Citation**:
  - `run.d.ts:5-6` — `RunStatus = "running" | "finished" | "error" |
    "cancelled"`; `RunResultStatus = Exclude<RunStatus, "running">`.
  - `messages.d.ts:62-67` — `SDKStatusMessage.status: "CREATING" |
    "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED"`.
  - Official docs (WebFetch): "Status moves to `'cancelled'`, …
    `run.wait()` resolves with `status: 'cancelled'`."
- **Implication for downstream phases**: Phase 04 status mapper:
  `SDKStatusMessage.status` UPPERCASE ↔ `runs.status` UPPERCASE (the
  harness uses uppercase per `CanonicalRunEvent`). The lowercase
  `RunStatus` from `Run.status` / `RunResult.status` requires an
  `.toUpperCase()` normalization. Note the `EXPIRED` value (spec doesn't
  mention) — treat as `ERROR` with `interrupted_reason = "expired"` until
  a dedicated `EXPIRED` column or status is added.

---

## OQ-14: Can a running `Run` stream be reattached after process restart?

- **Status**: verified
- **Answer**: Yes — two mechanisms exist:
  1. **`Agent.getRun(runId, options)`** returns a `Run` handle whose
     `.stream()` AsyncGenerator can be re-iterated. Cloud usage requires
     `{ runtime: "cloud", agentId }` (the parent agent ID). Local usage
     defaults to `runtime: "local"` and uses `cwd`.
  2. **`RunEventTailer.streamRunEvents(runId, { mode: "replay" | "tail"
     | "replay-and-tail", afterOffset, signal })`** is the lower-level
     event-store API used internally; it accepts an `AbortSignal` and
     supports replay, tail, or combined. It is exported as a class for
     advanced integration with the local run-event-store but is heavier
     than the `Agent.getRun` happy path.
- **Citation**:
  - `stubs.d.ts:51` — `Agent.getRun(runId: string, options?: GetRunOptions):
    Promise<Run>`.
  - `run.d.ts:32` — `Run.stream(): AsyncGenerator<SDKMessage, void>`
    (callable on the reattached Run).
  - `run-event-tailer.d.ts:3-31` — `RunEventTailerStreamOptions { mode?:
    "replay" | "tail" | "replay-and-tail"; afterOffset?; signal?:
    AbortSignal }`.
  - Official docs (WebFetch + blog `cursor.com/blog/typescript-sdk`):
    "reconnecting to a long-running cloud agent that was kicked off
    earlier, or continuing a conversation after the local process
    restarted."
- **Implication for downstream phases**: The spec §11 "Mid-run Server
  Crash Recovery" claim that "the current SDK surface does not include
  `Run.get` or stream reattachment" is **outdated** — v1.0.13 DOES
  support it via `Agent.getRun`. Phase 14 (recovery) should attempt
  reattach BEFORE marking the run interrupted, and only fall back to
  `interrupted_reason = "server_restart"` if reattach fails. Add this
  upgrade to the spec via an addendum (see `IMPLEMENTATION_STATUS.md`).

---

## OQ-15: What is the exact shape of `run.wait()` final result beyond usage?

- **Status**: verified
- **Answer**:
  ```ts
  interface RunResult {
    id: string;
    status: RunResultStatus;   // "finished" | "error" | "cancelled"
    result?: string;            // Final assistant text (best-effort)
    model?: ModelSelection;     // The model that actually answered
    durationMs?: number;        // Wall-clock duration
    git?: RunGitInfo;           // Branches + PR URLs (cloud-mostly)
  }

  interface RunGitInfo {
    branches: RunGitBranchInfo[];
  }
  interface RunGitBranchInfo {
    repoUrl: string;
    branch?: string;
    prUrl?: string;
  }
  ```
- **Citation**:
  - `run.d.ts:11-26` — full `RunResult` plus nested `RunGitBranchInfo` /
    `RunGitInfo` shapes.
- **Implication for downstream phases**: Phase 04 persistence stores
  `result`, `durationMs`, `model.id`, `model.params` JSON, and `git`
  branches array. The `model` field is the resolved model — useful when
  the user passed an alias (e.g. `"composer-2-fast"`) that the server
  may have rewritten. Phase 12 (cloud) renders `git.branches[*].prUrl`
  in the Run Detail view when present.

---

## OQ-16: What is the exact `CloudOptions` schema?

- **Status**: verified
- **Answer**: The cloud-side configuration lives under
  `AgentOptions.cloud: CloudAgentOptions`:
  ```ts
  interface CloudAgentOptions {
    env?: { type: "cloud" | "pool" | "machine"; name?: string };
    repos?: Array<{ url: string; startingRef?: string; prUrl?: string }>;
    workOnCurrentBranch?: boolean;
    autoCreatePR?: boolean;
    skipReviewerRequest?: boolean;
    envVars?: Record<string, string>;
  }
  ```
- **Citation**:
  - `options.d.ts:97-121` — full `CloudAgentOptions` interface (verbatim).
- **Implication for downstream phases**: Phase 06 cloud-settings UI swaps
  the JSON editor for a typed form per spec §15 Cloud mode "Partial". The
  `envVars` field is sensitive and must be masked in the UI and persisted
  encrypted-at-rest. `env.type === "machine"` requires a `name` —
  validate at submit time. `repos[*].prUrl` is mutually exclusive in
  practice with `workOnCurrentBranch` — flag a UI warning when both are
  set.

---

## OQ-17: What guarantees does `sandboxOptions.enabled` provide?

- **Status**: verified
- **Answer**: `LocalAgentOptions.sandboxOptions = { enabled: boolean }`.
  When `enabled: true`:
  - **macOS**: subprocess tree runs under Seatbelt via `sandbox-exec`. A
    dynamically generated profile denies file-writes to `.vscode/`,
    `.cursor/` (except `rules`, `commands`, `worktrees`, `skills`,
    `agents` subdirs), `.cursorignore`, `.git/config`, `.git/hooks/`, and
    `*.code-workspace` files. Network access is gated by approval prompts
    routed through the Cursor client/hooks system.
  - **Linux**: Landlock + seccomp. Filesystem restrictions are enforced
    via an overlay filesystem; unsafe syscalls (network and others) are
    blocked at the kernel level. Files matched by `.cursorignore` become
    truly inaccessible to the sandboxed process.
  - **Windows**: the Linux sandbox is run inside WSL2; no native Win32
    sandbox.
  - **All platforms**: the SDK guarantees a 40%-reduced-interruption
    pattern — the agent runs freely inside the box and emits `request`
    events (see OQ-09) when it needs to step outside, most commonly for
    network access.
  When `enabled: false`, no sandbox is applied and the agent runs with
  the same privileges as the Node process that invoked the SDK.
- **Citation**:
  - `options.d.ts:35-37` — `SandboxOptions { enabled: boolean }`.
  - `options.d.ts:80-90` — `LocalAgentOptions.sandboxOptions?:
    SandboxOptions`.
  - <https://cursor.com/blog/agent-sandboxing> — Seatbelt /
    Landlock+seccomp / WSL2 implementation details and reduced
    interruption metrics.
- **Implication for downstream phases**: Phase 10 security copy must
  reflect that sandboxing is OS-enforced, not heuristic. The harness's
  workspace allowlist (spec §2 / §10) is an *additional* defense; the
  SDK sandbox is the primary one. Default `sandboxOptions.enabled =
  true` per the spec's design.

---

## OQ-18: What `McpServerConfig` shapes are accepted inline?

- **Status**: verified
- **Answer**: Discriminated union with two variants:
  ```ts
  type McpServerConfig =
    | {
        type?: "stdio";
        command: string;
        args?: string[];
        env?: Record<string, string>;   // local only
        cwd?: string;                    // local only
      }
    | {
        type?: "http" | "sse";
        url: string;
        headers?: Record<string, string>;
        auth?: {
          CLIENT_ID: string;
          CLIENT_SECRET?: string;
          scopes?: string[];
        };
      };
  ```
  `type` is optional and inferred from which discriminator field is
  present (`command` → stdio, `url` → http/sse). Inline MCP definitions
  (passed via `AgentOptions.mcpServers` or `SendOptions.mcpServers`) are
  NOT persisted across `Agent.resume` — they live in memory only,
  intentionally, because they often carry secrets. File-based MCP
  configs (loaded via `local.settingSources`) survive resume.
- **Citation**:
  - `options.d.ts:18-33` — full `McpServerConfig` union (verbatim).
  - `agent.d.ts:19-43` — `SendOptions.mcpServers?: Record<string,
    McpServerConfig>` (per-send overrides).
  - Official docs (WebFetch): "Inline definitions in `Agent.create()` are
    not persisted across resume."
- **Implication for downstream phases**: Phase 05 MCP CRUD validates
  user-saved configs against the union above. Phase 04 agent-resume
  helper re-attaches saved MCP configs on every `Agent.resume` because
  the SDK does NOT remember them. Phase 10 security review: warn users
  when an MCP `args[]` looks like a literal credential (heuristic) and
  recommend using `env` instead.

---

## OQ-19: Does `Agent.list()` include agents from other apps or only this API key?

- **Status**: partial
- **Answer**:
  - For `runtime: "local"`, `Agent.list({ runtime: "local", cwd })`
    returns agents persisted to the local filesystem under that `cwd`
    (and its ancestors, by SDK convention). The scope is **per-cwd**, not
    per-API-key. Other Cursor processes that wrote to the same cwd will
    appear.
  - For `runtime: "cloud"`, `Agent.list({ runtime: "cloud", apiKey,
    prUrl?, includeArchived? })` is scoped to the **API key's owner**.
    Cloud agents created from the Cursor IDE/desktop client may not
    appear in the SDK-scoped list by default — per docs, they are
    "filtered out of the default agent list" and require a `Source >
    SDK` filter in the web UI. Cross-app visibility (whether an agent
    created from the Cursor desktop client by the same user is visible
    via SDK `Agent.list`) requires a smoke test to confirm.
- **Citation**:
  - `agent.d.ts:44-57` — `ListAgentsOptions` union with `runtime: "local"
    | "cloud"`, `cwd?`, `apiKey?`, `prUrl?`, `includeArchived?`.
  - Official docs (WebFetch summary): "Local agents are 'filtered to
    working tree'; cloud agents are 'filtered out of the default agent
    list' and require `Source > SDK` filter in web UI."
- **Implication for downstream phases**: Phase 07 Agent Picker should
  display SDK-visible agents only and label local agents with their cwd.
  Cloud agents created outside the harness may not show up — surface a
  "Open in Cursor Web" link to bridge the visibility gap. Re-test in
  Phase 12 once a real cloud key is in play. Update the spec with
  observed behavior.

---

## OQ-20: Does `Agent.get(agentId)` require the same model/options as creation?

- **Status**: verified (with nuance)
- **Answer**: `Agent.get(agentId, { cwd?, apiKey? })` does NOT require a
  `model` or any other create-time option — it returns only metadata
  (`SDKAgentInfo`). It is *cloud-only*; local agent lookup is "a
  post-launch followup" per the SDK declarations comment.
  However, **`Agent.resume(agentId, options?: Partial<AgentOptions>)`**
  is the path that re-instantiates a live `SDKAgent`, and per official
  docs: "`agent.model` is `undefined` on resume unless you pass `model`
  again. Inline definitions in `Agent.create()` are not persisted across
  resume — they often carry secrets and live in memory only. Pass them
  again on resume." So the resume path expects you to RE-PASS the model
  and the inline MCP servers, even though they're optional types.
- **Citation**:
  - `stubs.d.ts:35-73` — `Agent.get(agentId: string, options?:
    GetAgentOptions): Promise<SDKAgentInfo>` and
    `Agent.resume(agentId: string, options?: Partial<AgentOptions>):
    Promise<SDKAgent>`.
  - `agent.d.ts:129-132` — `GetAgentOptions { cwd?: string; apiKey?:
    string }`.
  - Official docs (WebFetch): "Model not automatically preserved on
    resume."
- **Implication for downstream phases**: Phase 04 must persist the model
  selection and any inline MCP configs on the harness side at agent
  create time, and pass them back into `Agent.resume` on every reload.
  Phase 07 Agent Picker reads metadata via `Agent.list`/`Agent.get` for
  display, then upgrades to a live handle via `Agent.resume(agentId,
  storedOptions)`. Document the "model must be re-passed" gotcha in the
  internal agent-resume helper.

---

## OQ-21: Which incremental markdown parser package best matches the app's streaming needs?

- **Status**: verified
- **Answer**: **`streaming-markdown@^0.2.15`** (`smd` API).
  - Designed expressly for ChatGPT-style streaming markdown.
  - Public API is push-based and incremental:
    `parser(renderer)`, `parser_write(p, chunk)`, `parser_end(p)`. The
    renderer interface (`add_token`, `end_token`, `add_text`,
    `set_attr`) maps cleanly onto the spec's block-boundary +
    leaf-text-mutation requirement.
  - Default renderer mounts directly into a `HTMLElement` root, which
    suits the spec's `StreamingMarkdown` strategy of letting the
    parser emit DOM nodes incrementally.
  - Small footprint (~82 KB unpacked, 7 files, MIT, last published
    2025-05-04, on v0.2.x line).
  - Versus alternatives:
    - **`marked@18`** (markedjs/marked): high-quality CommonMark parser
      with a tokenizer/walker model but is fundamentally
      *non-streaming*. Streaming "support" requires re-parsing the
      whole buffer on each chunk, which the spec explicitly rejects
      because it churns block-level DOM.
    - **`markdown-it@14`** (markdown-it/markdown-it): rich plugin
      ecosystem but the parse pass is also synchronous over a full
      buffer; streaming requires plugins like
      `markdown-it-textual-uml` or `markdown-it-incremental-dom`
      patterns, none of which match the spec's "leaf text mutation"
      requirement out-of-the-box.
- **Citation**:
  - `npm view streaming-markdown` — `name = "streaming-markdown"`,
    `version = "0.2.15"`, `description = "Streaming Markdown parser,
    à la ChatGPT"`, `license = "MIT"`, `types = "./smd.d.ts"`,
    `dist.unpackedSize = 82389`.
  - `node_modules/streaming-markdown/smd.d.ts` (verified in temporary
    `/tmp/md-survey/`): `parser`, `parser_write`, `parser_end`,
    `default_renderer`, `logger_renderer`, and token constants
    (`DOCUMENT`, `PARAGRAPH`, `HEADING_1`..`HEADING_5`, etc.).
  - Repo: <https://github.com/thetarnav/streaming-markdown>.
- **Implication for downstream phases**: Phase 09 pins
  `streaming-markdown@~0.2.15` (tilde because the package is still
  pre-1.0 and minor bumps can be breaking). The renderer adapter that
  bridges `streaming-markdown` tokens to React components lives at
  `apps/web/src/components/StreamingMarkdown/renderer.tsx`. Replace the
  default-renderer's `HTMLElement` mutation with a virtualization-aware
  delta queue.

---

## OQ-22: Which Lezer parsers cover all v1.1 languages cleanly?

- **Status**: verified (with shell caveat)
- **Answer**:
  | Language | Package | Version (at audit) | Notes |
  |---|---|---|---|
  | TypeScript | `@lezer/javascript` | `1.5.4` | Use `parser.configure({ dialect: "ts" })` |
  | JavaScript | `@lezer/javascript` | `1.5.4` | Default dialect or `dialect: "jsx"` for JSX |
  | Python | `@lezer/python` | `1.1.18` | First-party, complete grammar |
  | JSON | `@lezer/json` | `1.0.3` | First-party |
  | Markdown | `@lezer/markdown` | `1.6.3` | First-party; **incremental** — important for streaming code fences |
  | Highlight runtime | `@lezer/highlight` | `1.2.3` | Tag-based syntax highlighting layer used by all the above |
  | Tree primitives | `@lezer/common` | `1.5.2` | Required peer of the parsers; pin to compatible minor |
  | Shell | `@codemirror/legacy-modes/mode/shell` | (pkg `6.5.3`) | **NOT** a Lezer tree parser; a CodeMirror 5-style stream tokenizer ported into a `StreamLanguage`. The Lezer ecosystem has no first-party shell grammar. |
  | Plain text | (none) | n/a | No parser; render as text only |
  All packages are first-party (`marijn`, the Lezer/CodeMirror lead) and
  MIT licensed.
- **Citation**:
  - `npm view @lezer/javascript` — `1.5.4`, "lezer-based JavaScript
    grammar". README confirms `"ts"` and `"jsx"` dialects.
  - `npm view @lezer/python` — `1.1.18`.
  - `npm view @lezer/json` — `1.0.3`.
  - `npm view @lezer/markdown` — `1.6.3` ("Incremental Markdown parser
    that consumes and emits Lezer trees").
  - `npm view @lezer/highlight` — `1.2.3`.
  - `npm view @lezer/common` — `1.5.2`.
  - `npm view @codemirror/legacy-modes` — `6.5.3`. Exports include
    `./mode/shell`, verified in `/tmp/md-survey/node_modules/@codemirror
    /legacy-modes/mode/shell.{js,d.ts,cjs}`.
  - `npm view @codemirror/lang-shell` — **does not exist on npm** (404).
- **Implication for downstream phases**: Phase 10 `SyntaxHighlighter`
  registry maps the spec's seven languages to the packages above.
  Implementation note: for shell, wrap `@codemirror/legacy-modes/mode/
  shell.shell` in a `StreamLanguage.define(...)` adapter from
  `@codemirror/language` to expose it under the same parser interface as
  the Lezer-backed languages. The harness's `SyntaxHighlighter` accepts
  any parser that emits highlight tags compatible with `@lezer/highlight`.
  Add `cwd`-aware language detection for unknown files (e.g. `*.tsx` →
  TypeScript + JSX, `*.sh` → shell) in the file extension table.
- **Phase 10 resolution note (2026-05-23)**: Implemented the first-party
  Lezer parsers for TypeScript/JavaScript, Python, JSON, and Markdown,
  with `@lezer/highlight` and `@lezer/common` pinned at the audited
  versions. Shell highlighting intentionally uses a lightweight local
  regex tokenizer (`comment`, `string`, `command`, `flag`) instead of
  adding `@codemirror/language` + `@codemirror/legacy-modes`: OQ-22
  confirmed there is no clean Lezer shell tree parser, and the Phase 10
  animation loop only needs minimal visible shell categories. Revisit the
  `StreamLanguage` adapter if shell previews become a richer editing
  surface.

---

## Cross-cutting findings (not in the spec OQ list)

### F-1: `Run.supports(operation)` is the runtime feature flag
- The harness should never assume cancellation is available — always check
  `run.supports("cancel")` first and surface `run.unsupportedReason("cancel")`
  if false.
- Operations: `"stream" | "wait" | "cancel" | "conversation"`. Cite
  `run.d.ts:7-10`.

### F-2: `SendOptions.idempotencyKey` is exposed
- `agent.d.ts:42`. The harness should pass a UUID (run_id) here so the same
  prompt resubmitted after a network blip does not double-charge the API
  key.

### F-3: `Agent.prompt(message, options?)` one-shot convenience helper
- `stubs.d.ts:48`. Not used by the harness (which needs streaming) but
  useful for short server-side scripts.

### F-4: Errors are richly typed
- `errors.d.ts` exposes: `AuthenticationError`, `RateLimitError`,
  `ConfigurationError`, `AgentBusyError`, `IntegrationNotConnectedError`,
  `NetworkError`, `UnknownAgentError` — all subclasses of `CursorAgentError`
  / `CursorSdkError`. Each carries `{ code?, status?, isRetryable, cause?,
  endpoint?, requestId?, operation? }`. Phase 11 error mapping should
  prefer `instanceof` checks against these classes rather than parsing
  `.message`.

### F-5: `SendOptions.local.force` is the local-agent equivalent of cloud's `409 agent_busy`
- `agent.d.ts:32-41`. If a previous run was left "wedged" by a crashed
  CLI process, passing `local: { force: true }` expires it and starts a
  new follow-up. Phase 14 (recovery) uses this when re-issuing a prompt
  after the harness's own crash recovery promotes the run to ERROR.

### F-6: `agent.listArtifacts()` / `agent.downloadArtifact(path)` exists
- `agent.d.ts:16-17`. Used by cloud agents that produce file outputs
  (e.g. PR-bot uploads). Out of scope for v1.1 but trivially addable to
  the Run Detail view later.

---

## Verified runtime commands

| Command | Where it was run | Purpose | Result |
|---|---|---|---|
| `pnpm init` | `verification/` | scaffold | OK |
| `pnpm add @cursor/sdk typescript @types/node` | `verification/` | install | `@cursor/sdk@1.0.13` |
| `npx tsc --noEmit -p .` | `verification/` | type probes | passed (confirms `Run.cancel`, `Agent.getRun`, no `SendOptions.signal`, no `RunResult.usage`) |
| `pnpm add streaming-markdown @lezer/javascript @codemirror/legacy-modes` | `/tmp/md-survey/` | parser survey | confirms public APIs and shell mode presence |
| `npm view <pkg>` for 9 packages | shell | metadata audit | confirmed every chosen package exists with the stated version on npm |
