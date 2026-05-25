import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ContextChip, ContextSearchResult, ServerFrame } from "@harness/shared";
import { appendPromptHistory } from "../config.js";
import type { CliAgentSummary, CliMode, CliStreamPort } from "../types.js";
import { InputBar, parseSlashCommand, PromptHistory } from "./InputBar.js";
import { MentionPopup, flattenMentionResults, moveMentionSelection } from "./MentionPopup.js";
import { createStreamBuffer, ingestStreamFrame, StreamView, type StreamBuffer } from "./StreamView.js";
import { StatusBar } from "./StatusBar.js";

export interface ReplAppProps {
  agent: CliAgentSummary;
  mode: CliMode;
  modelId: string;
  workspace: string;
  historyEntries: string[];
  http: { createRun(input: { agentId: string; prompt: string; executionMode: CliMode; mentions?: ContextChip["mention"][] }): Promise<{ runId: string }> ; contextSearch(query: string): Promise<unknown> };
  stream: CliStreamPort;
}

export function App({ agent, mode: initialMode, modelId, workspace, historyEntries, http, stream }: ReplAppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<CliMode>(initialMode);
  const [buffer, setBuffer] = useState<StreamBuffer>(() => createStreamBuffer());
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [mentionResults, setMentionResults] = useState<ContextSearchResult | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [sessionCostMicros, setSessionCostMicros] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<{ runId: string; requestId: string } | null>(null);
  const history = new PromptHistory(historyEntries);
  const mentionItems = flattenMentionResults(mentionResults);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (activeRunId) {
        stream.cancelRun?.(activeRunId);
        return;
      }
      exit();
    }
    if (key.ctrl && input === "d") exit();
    if (pendingApproval && ["y", "n", "a"].includes(input)) {
      stream.sendApproval?.(pendingApproval.runId, pendingApproval.requestId, input === "n" ? "deny" : "approve", input === "a" ? "always" : undefined);
      setPendingApproval(null);
    }
  });

  const submitPrompt = (text: string) => {
    const slash = parseSlashCommand(text);
    if (slash) {
      handleSlashCommand(slash, setMode, setBuffer, exit);
      return;
    }
    void appendPromptHistory(text);
    setBuffer((current) => ({ items: [...current.items, { type: "assistant", text: `\n❯ ${text}\n` }] }));
    void http.createRun({ agentId: agent.id, prompt: text, executionMode: mode, mentions: chips.map((chip) => chip.mention) }).then((run) => {
      setActiveRunId(run.runId);
      return stream.subscribeToRun(run.runId, (frame: ServerFrame) => {
        setBuffer((current) => ingestStreamFrame(current, frame));
        if (frame.type === "sdk.request") setPendingApproval({ runId: run.runId, requestId: frame.event.payload.request_id });
        if (frame.type === "run.final_result") {
          setActiveRunId(null);
          setSessionCostMicros((current) => current + (frame.event.payload.usage.cost_usd_micros ?? 0));
        }
      });
    }).catch((error: unknown) => {
      setActiveRunId(null);
      setBuffer((current) => ({ items: [...current.items, { type: "error", message: error instanceof Error ? error.message : String(error) }] }));
    });
  };

  return (
    <Box flexDirection="column">
      <Text bold>Cursor Harness CLI — {agent.name} ({mode} mode)</Text>
      <Text dimColor>workspace: {workspace}</Text>
      <StreamView items={buffer.items} />
      <MentionPopup results={mentionResults} selectedIndex={mentionIndex} />
      <InputBar
        disabled={activeRunId !== null}
        chips={chips}
        history={history}
        mentionItems={mentionItems}
        selectedMentionIndex={mentionIndex}
        onMentionNavigate={(delta) => setMentionIndex((current) => moveMentionSelection(current, delta, mentionItems.length))}
        onMentionDismiss={() => setMentionResults(null)}
        onMentionSelect={(nextChips) => {
          setChips(nextChips);
          setMentionResults(null);
        }}
        onSubmit={submitPrompt}
        onChange={(_text, mention) => {
          if (!mention || mention.query.length === 0) {
            setMentionResults(null);
            return;
          }
          void http.contextSearch(mention.query).then((result) => {
            const maybe = result as ContextSearchResult;
            setMentionResults(maybe);
            setMentionIndex(Math.min(mentionIndex, Math.max(0, flattenMentionResults(maybe).length - 1)));
          }).catch(() => setMentionResults(null));
        }}
      />
      {activeRunId ? <Text dimColor>(waiting for current run to finish...)</Text> : null}
      <StatusBar agentName={agent.name} modelId={modelId} mode={mode} sessionCostMicros={sessionCostMicros} connection={activeRunId ? "connected" : "disconnected"} />
    </Box>
  );
}

function handleSlashCommand(
  slash: NonNullable<ReturnType<typeof parseSlashCommand>>,
  setMode: (mode: CliMode) => void,
  setBuffer: React.Dispatch<React.SetStateAction<StreamBuffer>>,
  exit: () => void,
): void {
  switch (slash.command) {
    case "mode":
      if (slash.args[0] === "ask" || slash.args[0] === "agent") setMode(slash.args[0]);
      return;
    case "clear":
      setBuffer(createStreamBuffer());
      return;
    case "exit":
      exit();
      return;
    case "history":
      setBuffer((current) => ({ items: [...current.items, { type: "assistant", text: "Use `harness history` for full run history." }] }));
      return;
    case "agent":
    case "model":
    case "unknown":
      setBuffer((current) => ({ items: [...current.items, { type: "error", message: "Unknown or unsupported slash command." }] }));
      return;
  }
}
