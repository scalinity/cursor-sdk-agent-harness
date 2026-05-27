import React, { useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentSummary, ContextChip, ContextSearchResult, ServerFrame } from "@harness/shared";
import { isRunStatusTerminalFrame, isTerminalFrame } from "../client/ws.js";
import { appendPromptHistory, writePreferences } from "../config.js";
import { renderTable, shortId } from "../output/table.js";
import type { CliAgentSummary, CliHttpPort, CliMode, CliStreamPort } from "../types.js";
import { HeaderBar } from "./HeaderBar.js";
import { InputBar, parseSlashCommand, PromptHistory, type MentionTrigger } from "./InputBar.js";
import { computeTuiLayout, countInputLines, MAX_INPUT_VISIBLE_LINES } from "./layout.js";
import { MentionPopup, flattenMentionResults, MAX_MENTION_ITEMS, moveMentionSelection } from "./MentionPopup.js";
import { filterSlashCommands, SlashPalette } from "./SlashPalette.js";
import { clampStreamScrollOffset, createStreamBuffer, ingestStreamFrame, StreamView, type StreamBuffer } from "./StreamView.js";
import { StatusBar } from "./StatusBar.js";
import { createTuiTheme, bg, border, fg, MIN_COLUMNS, MIN_ROWS } from "./theme.js";
import { useSpinnerFrame } from "./useSpinnerFrame.js";
import { useTerminalSize } from "./useTerminalSize.js";
import { useReplCleanup, type ReplCleanupController } from "./useReplCleanup.js";

export interface ReplAppProps {
  agent: CliAgentSummary;
  mode: CliMode;
  modelId: string;
  workspace: string;
  historyEntries: string[];
  http: CliHttpPort;
  stream: CliStreamPort;
}

type StreamConnectionStatus = "ready" | "connecting" | "connected" | "reconnecting" | "disconnected";

interface PromptRequest {
  text: string;
  agentId: string;
  mode: CliMode;
  mentions: Array<ContextChip["mention"]>;
}

export function formatUserPromptBlock(text: string): string {
  return `\n❯ ${text}\n\n`;
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
  const [agentTurnActive, setAgentTurnActive] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [queuedPrompts, setQueuedPrompts] = useState<PromptRequest[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamConnectionStatus>("ready");
  const [sessionCostMicros, setSessionCostMicros] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<{ runId: string; requestId: string } | null>(null);
  const [history] = useState(() => new PromptHistory(historyEntries));
  const queueRef = useRef<PromptRequest[]>([]);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionRequestSeqRef = useRef(0);
  const allMentionItems = flattenMentionResults(mentionResults);
  const mentionItems = mentionOpen ? allMentionItems.slice(0, MAX_MENTION_ITEMS) : [];
  const slashItems = !mentionOpen && inputDraft.startsWith("/") && !slashDismissed ? filterSlashCommands(inputDraft) : [];
  const slashOpen = slashItems.length > 0;
  const overlayLineCount = mentionOpen ? Math.min(9, Math.max(2, mentionItems.length + 1)) : slashOpen ? Math.min(7, slashItems.length + 1) : 0;
  const layout = computeTuiLayout(size, countInputLines(inputDraft, size.columns), overlayLineCount);
  const streamHeight = Math.max(1, layout.scrollHeight - 2);
  const streamWidth = Math.max(12, layout.columns - 4);
  const busy = activeRunId !== null || isStartingRun;
  const turnActive = isStartingRun || agentTurnActive;
  const spinner = useSpinnerFrame(turnActive);
  const activeLabel = turnActive ? `${spinner} ${isStartingRun ? "starting run" : "agent working"}` : undefined;
  const visibleActiveRunId = agentTurnActive ? activeRunId : null;
  const cleanupController = useReplCleanup({ stream, activeRunId, isStartingRun });

  const appendAssistant = (text: string) => setBuffer((current) => ({ items: [...current.items, { type: "assistant", text }] }));
  const appendError = (message: string) => setBuffer((current) => ({ items: [...current.items, { type: "error", message }] }));
  const promptSnapshot = (text: string): PromptRequest => ({
    text,
    agentId: activeAgent.id,
    mode,
    mentions: chips.map((chip) => chip.mention),
  });
  const clampOffset = (offset: number) => clampStreamScrollOffset(buffer.items, streamWidth, streamHeight, offset, activeLabel);
  const clearMentionState = () => {
    mentionRequestSeqRef.current += 1;
    clearMentionTimer(mentionTimerRef);
    setMentionResults(null);
    setMentionOpen(false);
    setMentionIndex(0);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "l") {
      setBuffer(createStreamBuffer());
      setScrollOffset(0);
      return;
    }
    if (key.shift && key.upArrow) {
      setScrollOffset((current) => clampOffset(current + 1));
      return;
    }
    if (key.shift && key.downArrow) {
      setScrollOffset((current) => Math.max(0, clampOffset(current) - 1));
      return;
    }
    if (key.pageUp) {
      const page = Math.max(3, Math.floor(streamHeight * 0.8));
      setScrollOffset((current) => clampOffset(current + page));
      return;
    }
    if (key.pageDown) {
      const page = Math.max(3, Math.floor(streamHeight * 0.8));
      setScrollOffset((current) => Math.max(0, clampOffset(current) - page));
      return;
    }
    if (key.ctrl && input === "c") {
      if (activeRunId) {
        const sent = stream.cancelRun?.(activeRunId) ?? false;
        appendAssistant(sent ? "\n[cancel requested]\n" : "\n[cancel unavailable: stream is not connected]\n");
        return;
      }
      if (isStartingRun) {
        cleanupController.cancelPendingStartRef.current = true;
        appendAssistant("\n[cancel requested once the run starts]\n");
        return;
      }
      if (inputDraft.length > 0) return;
      cleanupAndExit(cleanupController, exit);
    }
    if (key.ctrl && input === "d") cleanupAndExit(cleanupController, exit);
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
        cleanup: cleanupController,
        exit,
        setActiveAgent,
        setMode,
        setModelId,
        setBuffer,
        setScrollOffset,
      }).catch((error: unknown) => {
        appendError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const request = promptSnapshot(text);
    if (busy) {
      queueRef.current = [...queueRef.current, request];
      setQueuedPrompts(queueRef.current);
      appendAssistant(`(queued) ❯ ${text}`);
      return;
    }
    startPrompt(request);
  };

  const startPrompt = (request: PromptRequest) => {
    if (cleanupController.disposedRef.current) return;
    setIsStartingRun(true);
    setStreamStatus("connecting");
    setScrollOffset(0);
    appendPromptHistory(request.text).catch((error: unknown) => {
      appendError(`Prompt history was not saved: ${error instanceof Error ? error.message : String(error)}`);
    });
    appendAssistant(formatUserPromptBlock(request.text));
    void http.createRun({ agentId: request.agentId, prompt: request.text, executionMode: request.mode, mentions: request.mentions }).then((run) => {
      if (cleanupController.disposedRef.current) return;
      let runFinished = false;
      const finishRun = () => {
        if (runFinished) return;
        runFinished = true;
        setActiveRunId(null);
        setAgentTurnActive(false);
        setPendingApproval(null);
        setStreamStatus("ready");
        const next = queueRef.current[0];
        if (next !== undefined) {
          queueRef.current = queueRef.current.slice(1);
          setQueuedPrompts(queueRef.current);
          setTimeout(() => startPrompt(next), 0);
        }
      };
      setIsStartingRun(false);
      setActiveRunId(run.runId);
      setAgentTurnActive(true);
      setStreamStatus("connected");
      const subscription = stream.subscribeToRun(run.runId, (frame: ServerFrame) => {
        setBuffer((current) => ingestStreamFrame(current, frame, workspace));
        if (frame.type === "sdk.request") setPendingApproval({ runId: run.runId, requestId: frame.event.payload.request_id });
        if (isRunStatusTerminalFrame(frame)) {
          setAgentTurnActive(false);
          setPendingApproval(null);
          setStreamStatus("ready");
        }
        if (isTerminalFrame(frame)) {
          if (frame.type === "run.final_result") {
            setSessionCostMicros((current) => current + (frame.event.payload.usage.cost_usd_micros ?? 0));
          }
          finishRun();
        }
      });
      void subscription.then(() => finishRun()).catch((error: unknown) => {
        if (cleanupController.disposedRef.current) return;
        setIsStartingRun(false);
        setActiveRunId(null);
        setAgentTurnActive(false);
        setPendingApproval(null);
        setStreamStatus("disconnected");
        appendError(error instanceof Error ? error.message : String(error));
      });
      if (cleanupController.cancelPendingStartRef.current) {
        const sent = stream.cancelRun?.(run.runId) ?? false;
        cleanupController.cancelPendingStartRef.current = false;
        appendAssistant(sent ? "\n[cancel requested]\n" : "\n[cancel unavailable: stream is not connected]\n");
      }
    }).catch((error: unknown) => {
      if (cleanupController.disposedRef.current) return;
      setIsStartingRun(false);
      setActiveRunId(null);
      setAgentTurnActive(false);
      setStreamStatus("disconnected");
      appendError(error instanceof Error ? error.message : String(error));
    });
  };

  const handleInputChange = (text: string, mention: MentionTrigger | null) => {
    setInputDraft(text);
    setSlashDismissed(false);
    setSlashIndex((current) => clampSelectionIndex(current, filterSlashCommands(text).length));
    if (!mention) {
      clearMentionState();
      return;
    }
    setMentionOpen(true);
    if (mention.query.length === 0) {
      mentionRequestSeqRef.current += 1;
      clearMentionTimer(mentionTimerRef);
      setMentionResults({ files: [], symbols: [] });
      setMentionIndex(0);
      return;
    }
    const seq = mentionRequestSeqRef.current + 1;
    mentionRequestSeqRef.current = seq;
    clearMentionTimer(mentionTimerRef);
    mentionTimerRef.current = setTimeout(() => {
      void http.contextSearch(mention.query).then((result) => {
        if (mentionRequestSeqRef.current !== seq) return;
        const visibleCount = Math.min(MAX_MENTION_ITEMS, flattenMentionResults(result).length);
        setMentionResults(result);
        setMentionIndex((current) => clampSelectionIndex(current, visibleCount));
      }).catch((error: unknown) => {
        if (mentionRequestSeqRef.current !== seq) return;
        setMentionResults(null);
        appendError(`Context search failed for @${mention.query}: ${error instanceof Error ? error.message : String(error)}`);
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
        connection={streamStatus}
        activeRunId={visibleActiveRunId}
        queuedPrompts={queuedPrompts.length}
        spinner={spinner}
        theme={theme}
      />
      <Box flexDirection="column" height={layout.scrollHeight} borderStyle="round" {...border(scrollOffset > 0 ? theme.accent : theme.border)} paddingX={1} {...bg(theme.panel)}>
        <StreamView items={buffer.items} height={streamHeight} width={streamWidth} scrollOffset={scrollOffset} activeLabel={activeLabel} theme={theme} />
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
        maxVisibleLines={Math.max(1, Math.min(MAX_INPUT_VISIBLE_LINES, layout.inputHeight - 2))}
        theme={theme}
        onMentionNavigate={(delta) => setMentionIndex((current) => moveMentionSelection(current, delta, mentionItems.length))}
        onMentionDismiss={clearMentionState}
        onMentionSelect={(nextChips) => {
          setChips(nextChips);
          clearMentionState();
        }}
        onSlashNavigate={(delta) => setSlashIndex((current) => moveMentionSelection(current, delta, slashItems.length))}
        onSlashSelect={() => setSlashDismissed(true)}
        onSubmit={submitPrompt}
        onChange={handleInputChange}
        onClear={() => setInputDraft("")}
        onEscape={() => {
          setSlashDismissed(true);
          clearMentionState();
        }}
      />
      <StatusBar
        workspace={workspace}
        modelId={modelId}
        mode={mode}
        sessionCostMicros={sessionCostMicros}
        connection={streamStatus}
        queuedPrompts={queuedPrompts.length}
        activeRunId={visibleActiveRunId}
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
  cleanup: ReplCleanupController;
  exit: () => void;
  setActiveAgent: React.Dispatch<React.SetStateAction<CliAgentSummary>>;
  setMode: React.Dispatch<React.SetStateAction<CliMode>>;
  setModelId: React.Dispatch<React.SetStateAction<string>>;
  setBuffer: React.Dispatch<React.SetStateAction<StreamBuffer>>;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
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
      ctx.setScrollOffset(0);
      ctx.setBuffer(createStreamBuffer());
      return;
    case "exit":
      cleanupAndExit(ctx.cleanup, ctx.exit);
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

function cleanupAndExit(cleanup: ReplCleanupController, exit: () => void): void {
  cleanup.cleanupNow();
  exit();
}

function clampSelectionIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, current), total - 1);
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
