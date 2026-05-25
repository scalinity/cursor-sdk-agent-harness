import React, { useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentSummary, ContextChip, ContextSearchResult, ServerFrame } from "@harness/shared";
import { isTerminalFrame } from "../client/ws.js";
import { appendPromptHistory, writePreferences } from "../config.js";
import { sanitizeTerminalText } from "../output/sanitize.js";
import { renderTable, shortId } from "../output/table.js";
import type { CliAgentSummary, CliHttpPort, CliMode, CliStreamPort } from "../types.js";
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
  http: CliHttpPort;
  stream: CliStreamPort;
}

export function App({ agent, mode: initialMode, modelId: initialModelId, workspace, historyEntries, http, stream }: ReplAppProps) {
  const { exit } = useApp();
  const [activeAgent, setActiveAgent] = useState<CliAgentSummary>(agent);
  const [mode, setMode] = useState<CliMode>(initialMode);
  const [modelId, setModelId] = useState(initialModelId);
  const [buffer, setBuffer] = useState<StreamBuffer>(() => createStreamBuffer());
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [mentionResults, setMentionResults] = useState<ContextSearchResult | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>([]);
  const [sessionCostMicros, setSessionCostMicros] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<{ runId: string; requestId: string } | null>(null);
  const [history] = useState(() => new PromptHistory(historyEntries));
  const queueRef = useRef<string[]>([]);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionRequestSeqRef = useRef(0);
  const mentionItems = flattenMentionResults(mentionResults);
  const busy = activeRunId !== null || isStartingRun;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (activeRunId) {
        stream.cancelRun?.(activeRunId);
        return;
      }
      exit();
    }
    if (key.ctrl && input === "d") cleanupAndExit(activeRunId, stream, exit);
    if (pendingApproval && ["y", "n", "a"].includes(input)) {
      stream.sendApproval?.(pendingApproval.runId, pendingApproval.requestId, input === "n" ? "deny" : "approve", input === "a" ? "always" : undefined);
      setPendingApproval(null);
    }
  });

  const submitPrompt = (text: string) => {
    const slash = parseSlashCommand(text);
    if (slash) {
      void handleSlashCommand({
        slash,
        activeAgent,
        http,
        mode,
        modelId,
        workspace,
        stream,
        activeRunId,
        exit,
        setActiveAgent,
        setMode,
        setModelId,
        setBuffer,
      }).catch((error: unknown) => {
        setBuffer((current) => ({ items: [...current.items, { type: "error", message: error instanceof Error ? error.message : String(error) }] }));
      });
      return;
    }
    if (busy) {
      queueRef.current = [...queueRef.current, text];
      setQueuedPrompts(queueRef.current);
      setBuffer((current) => ({ items: [...current.items, { type: "assistant", text: `(queued) ❯ ${text}` }] }));
      return;
    }
    startPrompt(text);
  };

  const startPrompt = (text: string) => {
    setIsStartingRun(true);
    appendPromptHistory(text).catch((error: unknown) => {
      setBuffer((current) => ({
        items: [...current.items, { type: "error", message: `Prompt history was not saved: ${error instanceof Error ? error.message : String(error)}` }],
      }));
    });
    setBuffer((current) => ({ items: [...current.items, { type: "assistant", text: `\n❯ ${text}\n` }] }));
    void http.createRun({ agentId: activeAgent.id, prompt: text, executionMode: mode, mentions: chips.map((chip) => chip.mention) }).then((run) => {
      setIsStartingRun(false);
      setActiveRunId(run.runId);
      return stream.subscribeToRun(run.runId, (frame: ServerFrame) => {
        setBuffer((current) => ingestStreamFrame(current, frame));
        if (frame.type === "sdk.request") setPendingApproval({ runId: run.runId, requestId: frame.event.payload.request_id });
        if (isTerminalFrame(frame)) {
          setActiveRunId(null);
          setPendingApproval(null);
          if (frame.type === "run.final_result") {
            setSessionCostMicros((current) => current + (frame.event.payload.usage.cost_usd_micros ?? 0));
          }
          const next = queueRef.current[0];
          if (next !== undefined) {
            queueRef.current = queueRef.current.slice(1);
            setQueuedPrompts(queueRef.current);
            setTimeout(() => startPrompt(next), 0);
          }
        }
      });
    }).catch((error: unknown) => {
      setIsStartingRun(false);
      setActiveRunId(null);
      setBuffer((current) => ({ items: [...current.items, { type: "error", message: error instanceof Error ? error.message : String(error) }] }));
    });
  };

  return (
    <Box flexDirection="column">
      <Text bold>Cursor Harness CLI — {sanitizeTerminalText(activeAgent.name)} ({mode} mode)</Text>
      <Text dimColor>workspace: {sanitizeTerminalText(workspace)}</Text>
      <StreamView items={buffer.items} />
      <MentionPopup results={mentionResults} selectedIndex={mentionIndex} open={mentionOpen} />
      <InputBar
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
          if (!mention) {
            clearMentionTimer(mentionTimerRef);
            setMentionResults(null);
            setMentionOpen(false);
            return;
          }
          setMentionOpen(true);
          if (mention.query.length === 0) {
            clearMentionTimer(mentionTimerRef);
            setMentionResults({ files: [], symbols: [] });
            return;
          }
          const seq = mentionRequestSeqRef.current + 1;
          mentionRequestSeqRef.current = seq;
          clearMentionTimer(mentionTimerRef);
          mentionTimerRef.current = setTimeout(() => {
            void http.contextSearch(mention.query).then((result) => {
              if (mentionRequestSeqRef.current !== seq) return;
              setMentionResults(result);
              setMentionIndex(Math.min(mentionIndex, Math.max(0, flattenMentionResults(result).length - 1)));
            }).catch(() => {
              if (mentionRequestSeqRef.current === seq) setMentionResults(null);
            });
          }, 150);
        }}
      />
      {busy ? <Text dimColor>(waiting for current run to finish...)</Text> : null}
      {queuedPrompts.length > 0 ? <Text dimColor>queued: {queuedPrompts.length}</Text> : null}
      <StatusBar agentName={activeAgent.name} modelId={modelId} mode={mode} sessionCostMicros={sessionCostMicros} connection={activeRunId ? "connected" : "disconnected"} />
    </Box>
  );
}

interface SlashCommandContext {
  slash: NonNullable<ReturnType<typeof parseSlashCommand>>;
  activeAgent: CliAgentSummary;
  http: CliHttpPort;
  mode: CliMode;
  modelId: string;
  workspace: string;
  stream: CliStreamPort;
  activeRunId: string | null;
  exit: () => void;
  setActiveAgent: React.Dispatch<React.SetStateAction<CliAgentSummary>>;
  setMode: React.Dispatch<React.SetStateAction<CliMode>>;
  setModelId: React.Dispatch<React.SetStateAction<string>>;
  setBuffer: React.Dispatch<React.SetStateAction<StreamBuffer>>;
}

async function handleSlashCommand(ctx: SlashCommandContext): Promise<void> {
  const { slash, setBuffer } = ctx;
  const appendMessage = (message: string) => setBuffer((current) => ({ items: [...current.items, { type: "assistant", text: message }] }));
  const appendError = (message: string) => setBuffer((current) => ({ items: [...current.items, { type: "error", message }] }));
  switch (slash.command) {
    case "mode":
      if (slash.args[0] === "ask" || slash.args[0] === "agent") {
        ctx.setMode(slash.args[0]);
        await writePreferences({ lastAgentId: ctx.activeAgent.id, preferredMode: slash.args[0], preferredModel: ctx.modelId });
        appendMessage(`Mode switched to ${slash.args[0]}.`);
      } else {
        appendError("Usage: /mode ask | /mode agent");
      }
      return;
    case "clear":
      ctx.setBuffer(createStreamBuffer());
      return;
    case "exit":
      cleanupAndExit(ctx.activeRunId, ctx.stream, ctx.exit);
      return;
    case "history":
      await showInlineHistory(ctx.http, ctx.activeAgent.id, appendMessage);
      return;
    case "agent":
      await switchAgent(slash.args.join(" "), ctx, appendMessage, appendError);
      return;
    case "model":
      await switchModel(slash.args[0], ctx, appendMessage, appendError);
      return;
    case "unknown":
      appendError("Unknown slash command.");
      return;
  }
}

function clearMentionTimer(ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (ref.current) clearTimeout(ref.current);
  ref.current = null;
}

function cleanupAndExit(activeRunId: string | null, stream: CliStreamPort, exit: () => void): void {
  if (activeRunId) stream.cancelRun?.(activeRunId);
  stream.close?.();
  exit();
}

async function showInlineHistory(
  http: CliHttpPort,
  agentId: string,
  appendMessage: (message: string) => void,
): Promise<void> {
  const result = await http.listRuns({ agentId, limit: 5 });
  appendMessage(renderTable(result.items, [
    { key: "id", header: "Run", value: (run) => shortId(run.id) },
    { key: "status", header: "Status", value: (run) => run.status },
    { key: "prompt", header: "Prompt", value: (run) => run.promptPreview, maxWidth: 48 },
  ]));
}

async function switchAgent(
  selector: string,
  ctx: SlashCommandContext,
  appendMessage: (message: string) => void,
  appendError: (message: string) => void,
): Promise<void> {
  if (!selector) {
    appendError("Usage: /agent <name-or-id>");
    return;
  }
  const agents = await ctx.http.listAgents({ limit: 500 });
  const summary = agents.items.find((item) => item.id === selector || item.name === selector);
  const detail = summary ? await ctx.http.getAgent(summary.id) : await ctx.http.getAgent(selector);
  const next = cliAgentFromSummary(detail);
  ctx.setActiveAgent(next);
  ctx.setModelId(next.modelId);
  ctx.setMode(next.executionMode);
  await writePreferences({ lastAgentId: next.id, preferredMode: next.executionMode, preferredModel: next.modelId });
  appendMessage(`Agent switched to ${next.name}.`);
}

async function switchModel(
  model: string | undefined,
  ctx: SlashCommandContext,
  appendMessage: (message: string) => void,
  appendError: (message: string) => void,
): Promise<void> {
  if (!model) {
    appendError("Usage: /model <id>");
    return;
  }
  const next = await ctx.http.getOrCreateAgent({ model, mode: ctx.mode, workspace: ctx.workspace });
  ctx.setActiveAgent(next);
  ctx.setModelId(next.modelId);
  await writePreferences({ lastAgentId: next.id, preferredMode: ctx.mode, preferredModel: next.modelId });
  appendMessage(`Model switched to ${next.modelId}.`);
}

function cliAgentFromSummary(agent: Pick<AgentSummary, "id" | "name" | "modelId" | "executionMode">): CliAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    modelId: agent.modelId,
    executionMode: agent.executionMode === "ask" ? "ask" : "agent",
  };
}
