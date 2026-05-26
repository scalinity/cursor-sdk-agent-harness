import React, { useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentSummary, ContextChip, ContextSearchResult, ServerFrame } from "@harness/shared";
import { isTerminalFrame } from "../client/ws.js";
import { appendPromptHistory, writePreferences } from "../config.js";
import { renderTable, shortId } from "../output/table.js";
import type { CliAgentSummary, CliHttpPort, CliMode, CliStreamPort } from "../types.js";
import { HeaderBar } from "./HeaderBar.js";
import { InputBar, parseSlashCommand, PromptHistory, type MentionTrigger } from "./InputBar.js";
import { computeTuiLayout, countInputLines } from "./layout.js";
import { MentionPopup, flattenMentionResults, moveMentionSelection } from "./MentionPopup.js";
import { filterSlashCommands, SlashPalette } from "./SlashPalette.js";
import { createStreamBuffer, ingestStreamFrame, StreamView, type StreamBuffer } from "./StreamView.js";
import { StatusBar } from "./StatusBar.js";
import { createTuiTheme, bg, border, fg, MIN_COLUMNS, MIN_ROWS } from "./theme.js";
import { useSpinnerFrame } from "./useSpinnerFrame.js";
import { useTerminalSize } from "./useTerminalSize.js";

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
  const theme = createTuiTheme();
  const size = useTerminalSize();
  const [activeAgent, setActiveAgent] = useState<CliAgentSummary>(agent);
  const [mode, setMode] = useState<CliMode>(initialMode);
  const [modelId, setModelId] = useState(initialModelId);
  const [buffer, setBuffer] = useState<StreamBuffer>(() => createStreamBuffer());
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [mentionResults, setMentionResults] = useState<ContextSearchResult | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [inputDraft, setInputDraft] = useState("");
  const [scrollOffset, setScrollOffset] = useState(0);
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
  const slashItems = !mentionOpen && inputDraft.startsWith("/") && !slashDismissed ? filterSlashCommands(inputDraft) : [];
  const slashOpen = slashItems.length > 0;
  const overlayLineCount = mentionOpen ? Math.min(9, Math.max(2, mentionItems.length + 1)) : slashOpen ? Math.min(7, slashItems.length + 1) : 0;
  const layout = computeTuiLayout(size, countInputLines(inputDraft), overlayLineCount);
  const busy = activeRunId !== null || isStartingRun;
  const spinner = useSpinnerFrame(busy);
  const connectionStatus = activeRunId !== null ? "connected" : isStartingRun ? "connecting" : "ready";
  const activeLabel = busy ? `${spinner} ${isStartingRun ? "starting run" : "agent working"}` : undefined;

  useInput((input, key) => {
    if (key.ctrl && input === "l") {
      setBuffer(createStreamBuffer());
      setScrollOffset(0);
      return;
    }
    if (key.pageUp) {
      setScrollOffset((current) => current + Math.max(3, Math.floor(layout.scrollHeight * 0.8)));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((current) => Math.max(0, current - Math.max(3, Math.floor(layout.scrollHeight * 0.8))));
      return;
    }
    if (key.ctrl && input === "c") {
      if (activeRunId) {
        stream.cancelRun?.(activeRunId);
        setBuffer((current) => ({ items: [...current.items, { type: "assistant", text: "\n[cancel requested]\n" }] }));
        return;
      }
      if (inputDraft.length > 0) return;
      cleanupAndExit(activeRunId, stream, exit);
    }
    if (key.ctrl && input === "d") cleanupAndExit(activeRunId, stream, exit);
    if (pendingApproval && ["y", "n", "a"].includes(input)) {
      stream.sendApproval?.(pendingApproval.runId, pendingApproval.requestId, input === "n" ? "deny" : "approve", input === "a" ? "always" : undefined);
      setPendingApproval(null);
    }
  });

  const submitPrompt = (text: string) => {
    setSlashDismissed(false);
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
    setScrollOffset(0);
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
        setScrollOffset(0);
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

  const handleInputChange = (text: string, mention: MentionTrigger | null) => {
    setInputDraft(text);
    setSlashDismissed(false);
    if (!text.startsWith("/")) setSlashIndex(0);
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
  };

  if (!layout.canRender) {
    return <TooSmallTerminal columns={layout.columns} rows={layout.rows} theme={theme} />;
  }

  return (
    <Box flexDirection="column" width={layout.columns} height={layout.rows} {...bg(theme.background)}>
      <HeaderBar
        width={layout.columns}
        workspace={workspace}
        mode={mode}
        modelId={modelId}
        connection={connectionStatus}
        activeRunId={activeRunId}
        queuedPrompts={queuedPrompts.length}
        spinner={spinner}
        theme={theme}
      />
      <Box flexDirection="column" height={layout.scrollHeight} borderStyle="round" {...border(theme.border)} paddingX={1} {...bg(theme.panel)}>
        <StreamView items={buffer.items} height={Math.max(1, layout.scrollHeight - 2)} width={Math.max(12, layout.columns - 4)} scrollOffset={scrollOffset} activeLabel={activeLabel} theme={theme} />
      </Box>
      {mentionOpen ? <MentionPopup results={mentionResults} selectedIndex={mentionIndex} open={mentionOpen} theme={theme} /> : null}
      {!mentionOpen && slashOpen ? <SlashPalette items={slashItems} selectedIndex={slashIndex} theme={theme} /> : null}
      <InputBar
        chips={chips}
        history={history}
        mentionItems={mentionItems}
        selectedMentionIndex={mentionIndex}
        slashItems={slashOpen ? slashItems : []}
        selectedSlashIndex={slashIndex}
        width={layout.columns}
        theme={theme}
        onMentionNavigate={(delta) => setMentionIndex((current) => moveMentionSelection(current, delta, mentionItems.length))}
        onMentionDismiss={() => {
          setMentionResults(null);
          setMentionOpen(false);
        }}
        onMentionSelect={(nextChips) => {
          setChips(nextChips);
          setMentionResults(null);
          setMentionOpen(false);
        }}
        onSlashNavigate={(delta) => setSlashIndex((current) => moveMentionSelection(current, delta, slashItems.length))}
        onSlashSelect={() => setSlashDismissed(true)}
        onSubmit={submitPrompt}
        onChange={handleInputChange}
        onClear={() => setInputDraft("")}
        onEscape={() => {
          setSlashDismissed(true);
          setMentionResults(null);
          setMentionOpen(false);
        }}
      />
      <StatusBar
        workspace={workspace}
        modelId={modelId}
        mode={mode}
        sessionCostMicros={sessionCostMicros}
        connection={connectionStatus}
        queuedPrompts={queuedPrompts.length}
        activeRunId={activeRunId}
        width={layout.columns}
        theme={theme}
      />
    </Box>
  );
}

function TooSmallTerminal({ columns, rows, theme }: { columns: number; rows: number; theme: ReturnType<typeof createTuiTheme> }) {
  return (
    <Box flexDirection="column" paddingX={1} {...bg(theme.background)}>
      <Text {...fg(theme.accentWarm)} bold>▌ Cursor Harness</Text>
      <Text {...fg(theme.warning)}>terminal too small: {columns}x{rows}</Text>
      <Text {...fg(theme.muted)}>minimum supported size is {MIN_COLUMNS}x{MIN_ROWS}</Text>
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
        await writePreferences({ preferredMode: slash.args[0], preferredModel: ctx.modelId });
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
  await writePreferences({ preferredMode: next.executionMode, preferredModel: next.modelId });
  appendMessage("Session switched.");
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
  await writePreferences({ preferredMode: ctx.mode, preferredModel: next.modelId });
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
