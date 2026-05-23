import type { CanonicalRunEvent, RunRecord } from "../state/run-store.js";
import { EventTimeline } from "../components/shell/EventTimeline.js";
import { CodeEditPreviewPanel } from "../components/streaming/CodeEditPreviewPanel.js";
import { RunStatusPill } from "../components/streaming/RunStatusPill.js";
import { useStreamingQaFixture } from "../hooks/useStreamingQaFixture.js";

const RUN_ID = "phase09-streaming-fixture";
const AGENT_ID = "agent-fixture";
const NOW = "2026-05-23T15:00:00.000Z";

const assistantText = [
  "# Streaming surface smoke",
  "",
  "The assistant renderer should keep prose moving without rebuilding React on every token.",
  "",
  "- Markdown list item one",
  "- Markdown list item two with inline code markers preserved as text for Phase 09",
  "",
  "```ts",
  "const status = \"streaming\";",
  "console.log(status);",
  "```",
  "",
  "> Thinking and assistant text share the same block projection path.",
  "",
  "| Surface | State |",
  "|---|---|",
  "| Markdown | live |",
  "| Tool lane | fanout |",
  "",
].join("\n");

const thinkingText =
  "Two concurrent tool calls should share a lane while they overlap. Completed cards may collapse after the timer unless pinned.";

function event(input: {
  seq: number;
  sdkType: CanonicalRunEvent["sdk_type"];
  kind: string;
  payload: unknown;
}): CanonicalRunEvent {
  return {
    event_id: `00000000-0000-0000-0000-${input.seq.toString().padStart(12, "0")}`,
    schema_version: 1,
    seq: input.seq,
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    occurred_at: NOW,
    received_at: NOW,
    sdk_type: input.sdkType,
    kind: input.kind,
    payload: input.payload,
  };
}

const events: CanonicalRunEvent[] = [
  event({
    seq: 1,
    sdkType: "system",
    kind: "system.init",
    payload: {
      subtype: "init",
      mode: "local",
      model: { id: "composer-2-5-fast" },
      tools: ["read_file", "grep", "edit_file", "shell"],
      cwd: ["/tmp/harness-fixture"],
      sandbox_enabled: true,
    },
  }),
  event({
    seq: 2,
    sdkType: "user",
    kind: "user.message",
    payload: { role: "user", content: [{ type: "text", text: "Show me a long markdown stream." }] },
  }),
  event({
    seq: 3,
    sdkType: "thinking",
    kind: "thinking.delta",
    payload: {
      text_delta: thinkingText,
      full_text_length: thinkingText.length,
      is_replacement: false,
      thinking_duration_ms: 4200,
    },
  }),
  event({
    seq: 4,
    sdkType: "assistant",
    kind: "assistant.delta",
    payload: {
      role: "assistant",
      text_delta: assistantText,
      full_text_length: assistantText.length,
      is_replacement: false,
      tool_uses: [],
    },
  }),
  event({
    seq: 5,
    sdkType: "tool_call",
    kind: "tool_call.running",
    payload: {
      call_id: "call-read",
      name: "read_file",
      status: "running",
      args: { path: "src/cursor.ts", range: "70:110" },
      timing: { started_at: NOW },
    },
  }),
  event({
    seq: 6,
    sdkType: "tool_call",
    kind: "tool_call.running",
    payload: {
      call_id: "call-grep",
      name: "grep",
      status: "running",
      args: { pattern: "decodeCursor", path: "src" },
      timing: { started_at: NOW },
    },
  }),
  event({
    seq: 7,
    sdkType: "tool_call",
    kind: "tool_call.completed",
    payload: {
      call_id: "call-read",
      name: "read_file",
      status: "completed",
      args: { path: "src/cursor.ts", range: "70:110" },
      result: { linesRead: 41, fileSize: 1433, contract: "exclusive cursor" },
      timing: { started_at: NOW, completed_at: NOW, duration_ms: 38 },
    },
  }),
  event({
    seq: 8,
    sdkType: "tool_call",
    kind: "tool_call.completed",
    payload: {
      call_id: "call-grep",
      name: "grep",
      status: "completed",
      args: { pattern: "decodeCursor", path: "src" },
      result: { matches: ["src/cursor.ts:87", "src/routes/search.ts:42"], byteCount: 812 },
      timing: { started_at: NOW, completed_at: NOW, duration_ms: 142 },
    },
  }),
  event({
    seq: 9,
    sdkType: "tool_call",
    kind: "code_edit.detected",
    payload: {
      source_call_id: "call-grep",
      confidence: "high",
      edits: [
        {
          path: "src/routes/search.ts",
          language: "typescript",
          before: "const cursor = decodeCursor(req.query.cursor);\nreturn search(cursor);\n",
          after: "const cursor = decodeCursor(req.query.cursor);\nif (!cursor.valid) return reply.code(400).send({ error: \"bad cursor\" });\nreturn search(cursor);\n",
          operations: [
            {
              type: "insert",
              startOffset: 46,
              endOffset: 46,
              text: "if (!cursor.valid) return reply.code(400).send({ error: \"bad cursor\" });\n",
            },
          ],
        },
      ],
    },
  }),
  event({
    seq: 10,
    sdkType: "status",
    kind: "run.final_result",
    payload: {
      usage: {
        input_tokens: 2800,
        output_tokens: 6200,
        cached_input_tokens: 1400,
        reasoning_tokens: null,
        cost_usd_micros: 41_900,
        usage_source: "sdk_final_result",
      },
    },
  }),
];

const fixtureRun: RunRecord = {
  id: RUN_ID,
  agentId: AGENT_ID,
  status: "FINISHED",
  startedAt: NOW,
  finishedAt: NOW,
  finalText: assistantText,
  interruptedReason: null,
  usage: {
    input_tokens: 2800,
    output_tokens: 6200,
    cached_input_tokens: 1400,
    reasoning_tokens: null,
    cost_usd_micros: 41_900,
    usage_source: "sdk_final_result",
  },
  usageSource: "sdk_final_result",
  durationMs: 4900,
};

const fixture = {
  run: fixtureRun,
  events,
  assistantText,
  thinkingText,
  toolCallCount: 4,
};

export function StreamingQA() {
  useStreamingQaFixture(fixture);
  return (
    <main className="min-h-screen bg-background p-6 text-text-primary">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center justify-between border-b border-border-subtle pb-3">
          <div>
            <h1 className="text-xl font-semibold">Phase 09 Streaming QA</h1>
            <p className="text-sm text-text-tertiary">Dev fixture for markdown, thinking, tool fanout, and usage states.</p>
          </div>
          <RunStatusPill runId={RUN_ID} />
        </div>
        <EventTimeline runId={RUN_ID} />
        <div className="mt-6 overflow-hidden border border-border-subtle bg-surface-1">
          <CodeEditPreviewPanel runId={RUN_ID} />
        </div>
      </div>
    </main>
  );
}
