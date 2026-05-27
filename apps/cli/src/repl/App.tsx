import React, { useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentSummary, ContextChip, ContextSearchResult, ServerFrame, TokenUsage } from "@harness/shared";
import { isRunStatusTerminalFrame, isTerminalFrame } from "../client/ws.js";
import { appendPromptHistory, writePreferences } from "../config.js";
import {
  attachmentImages,
  formatImageDropFailure,
  MAX_IMAGE_ATTACHMENTS,
  mergeImageAttachments,
  readImageFromPath,
  selectImageDropPaths,
  type ImageAttachment,
} from "../lib/attachments.js";
import { createSkill, listSkills, resolveSkillBySlashCommand, readSkillBody, buildSkillInvocationPrompt } from "../lib/skills.js";
import { renderTable, shortId } from "../output/table.js";
import type { CliAgentSummary, CliHttpPort, CliMode, CliStreamPort } from "../types.js";
import { HeaderBar, type ChromeState } from "./HeaderBar.js";
import { InputBar, parseSlashCommand, PromptHistory, type MentionTrigger } from "./InputBar.js";
import { computeTuiLayout, countInputLines, MAX_INPUT_VISIBLE_LINES } from "./layout.js";
import { MentionPopup, flattenMentionResults, MAX_MENTION_ITEMS, moveMentionSelection } from "./MentionPopup.js";
import { filterSlashCommands, SlashPalette } from "./SlashPalette.js";
import { computeStreamViewportState, createStreamBuffer, ingestStreamFrame, StreamView, type StreamBuffer, type StreamItem } from "./StreamView.js";
import { applyStreamScrollDelta, resolveStreamScrollDelta } from "./stream-scroll.js";
import { StatusBar, type SessionCostState, type SessionTokenState } from "./StatusBar.js";
import { formatActiveToolLine } from "./ToolCallLine.js";
import { createTuiTheme, bg, border, fg, truncateMiddle, MIN_COLUMNS, MIN_ROWS } from "./theme.js";
import {
  formatThinkingGradientSegments,
  formatThinkingIndicatorText,
  thinkingGradientPeakIndex,
  useSpinnerFrameState,
  type ThinkingGradientSegment,
} from "./useSpinnerFrame.js";
import { useTerminalSize } from "./useTerminalSize.js";
import { useReplCleanup, type ReplCleanupController } from "./useReplCleanup.js";
import { useResumeNotice } from "./useResumeNotice.js";
import { useSessionSnapshotRegistration, type ReplSessionSnapshotState } from "./useSessionSnapshotRegistration.js";
import { useMentionTimerCleanup } from "./useMentionTimerCleanup.js";
import { useStreamScrollClamp } from "./useStreamScrollClamp.js";
import type { CliSessionSnapshot } from "../session.js";

const MAX_QUEUED_PROMPTS = 8;

export interface ReplResumeState {
  buffer: StreamBuffer;
  sessionCost: SessionCostState;
  sessionTokens: SessionTokenState;
  scrollOffset: number;
}

export interface ReplAppProps {
  agent: CliAgentSummary;
  mode: CliMode;
  modelId: string;
  workspace: string;
  historyEntries: string[];
  http: CliHttpPort;
  stream: CliStreamPort;
  resume?: ReplResumeState;
  onRegisterSessionSnapshot?: (getter: () => CliSessionSnapshot) => void;
}

type StreamConnectionStatus = "ready" | "connecting" | "connected" | "reconnecting" | "disconnected";

interface PromptRequest {
  text: string;
  agentId: string;
  mode: CliMode;
  mentions: Array<ContextChip["mention"]>;
  images: ImageAttachment[];
}

interface QueuedPrompt {
  request: PromptRequest;
  userDisplay?: string;
}

export function formatTurnClock(date: Date = new Date()): string {
  return date.toTimeString().slice(0, 5);
}

export { formatThinkingGradientSegments, formatThinkingIndicatorText, thinkingGradientPeakIndex };

export function App({
  agent,
  mode: initialMode,
  modelId: initialModelId,
  workspace,
  historyEntries,
  http,
  stream,
  resume,
  onRegisterSessionSnapshot,
}: ReplAppProps) {
  const { exit } = useApp();
  const theme = createTuiTheme();
  const size = useTerminalSize();
  const [activeAgent, setActiveAgent] = useState<CliAgentSummary>(agent);
  const [mode, setMode] = useState<CliMode>(initialMode);
  const [modelId, setModelId] = useState(initialModelId);
  const [buffer, setBuffer] = useState<StreamBuffer>(() => resume?.buffer ?? createStreamBuffer());
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [mentionResults, setMentionResults] = useState<ContextSearchResult | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [inputDraft, setInputDraft] = useState("");
  const [scrollOffset, setScrollOffset] = useState(resume?.scrollOffset ?? 0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [agentTurnActive, setAgentTurnActive] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamConnectionStatus>("ready");
  const [sessionCost, setSessionCost] = useState<SessionCostState>(() => resume?.sessionCost ?? createEmptySessionCost());
  const [sessionTokens, setSessionTokens] = useState<SessionTokenState>(() => resume?.sessionTokens ?? createEmptySessionTokens());
  const [pendingApproval, setPendingApproval] = useState<{ runId: string; requestId: string } | null>(null);
  const [history] = useState(() => new PromptHistory(historyEntries));
  const queueRef = useRef<QueuedPrompt[]>([]);
  const toolStartRef = useRef<{ callId: string; startMs: number } | null>(null);
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
  const spinnerState = useSpinnerFrameState(turnActive);
  const spinner = spinnerState.frame;
  const runningTool = toolStartRef.current ? findRunningTool(buffer.items, toolStartRef.current.callId) : undefined;
  const lastItem = buffer.items.at(-1);
  const chromeState = deriveChromeState({ streamStatus, turnActive, busy, toolRunning: runningTool !== undefined, lastItemType: lastItem?.type });
  const [cwdBase] = useState(() => safeProcessCwd(workspace));
  // ASSUMPTION: The CLI is single-user until a multi-account config exists; label
  // the active context as "local" rather than inventing account support here.
  // Flag if wrong.
  const accountLabel = "local";
  const thinkingText = formatThinkingIndicatorText(spinnerState.index);
  const thinkingLabelText = `${spinner} ${thinkingText}`;
  const thinkingGradientPeak = thinkingGradientPeakIndex(spinnerState.index, thinkingText.length);
  const activeLabel = turnActive
    ? (runningTool && toolStartRef.current
        ? truncateMiddle(formatActiveToolLine(spinner, runningTool, Date.now() - toolStartRef.current.startMs), streamWidth)
        : truncateMiddle(isStartingRun ? `${spinner} starting run` : thinkingLabelText, streamWidth))
    : undefined;
  const spinnerSegment: ThinkingGradientSegment | undefined = spinner
    ? (theme.state?.running ? { text: `${spinner} `, color: theme.state.running } : { text: `${spinner} ` })
    : undefined;
  const activeLabelSegments: ThinkingGradientSegment[] | undefined = turnActive && !runningTool && !isStartingRun && activeLabel === thinkingLabelText
    ? [
        ...(spinnerSegment ? [spinnerSegment] : []),
        ...formatThinkingGradientSegments(thinkingText, thinkingGradientPeak, {
          dim: theme.muted,
          mid: theme.state?.running,
          bright: theme.state?.running,
        }),
      ]
    : undefined;
  const cleanupController = useReplCleanup({ stream, activeRunId, isStartingRun });
  const streamViewport = useMemo(
    () => computeStreamViewportState(buffer.items, streamWidth, streamHeight, scrollOffset, activeLabel),
    [activeLabel, buffer.items, scrollOffset, streamHeight, streamWidth],
  );
  const { maxOffset, bodyHeight, effectiveOffset, streamScrollActive } = streamViewport;
  const sessionStateRef = useRef<ReplSessionSnapshotState>({
    workspace,
    agent,
    mode: initialMode,
    modelId: initialModelId,
    sessionCost: resume?.sessionCost ?? createEmptySessionCost(),
    sessionTokens: resume?.sessionTokens ?? createEmptySessionTokens(),
    buffer: resume?.buffer ?? createStreamBuffer(),
    scrollOffset: resume?.scrollOffset ?? 0,
  });
  sessionStateRef.current = {
    workspace,
    agent: activeAgent,
    mode,
    modelId,
    sessionCost,
    sessionTokens,
    buffer,
    scrollOffset: effectiveOffset,
  };
  useSessionSnapshotRegistration(onRegisterSessionSnapshot, sessionStateRef);
  useResumeNotice(resume !== undefined, setBuffer);
  useMentionTimerCleanup(mentionTimerRef, mentionRequestSeqRef);
  const inputFocused = !busy;
  useStreamScrollClamp(scrollOffset, effectiveOffset, setScrollOffset);

  const appendUser = (text: string) => setBuffer((current) => ({ items: [...current.items, { type: "user", text, at: formatTurnClock() }] }));
  const appendSystem = (text: string) => setBuffer((current) => ({ items: [...current.items, { type: "system", text }] }));
  const appendError = (message: string) => setBuffer((current) => ({ items: [...current.items, { type: "error", message }] }));
  const promptSnapshot = (text: string, overrides?: { mentions?: Array<ContextChip["mention"]>; images?: ImageAttachment[] }): PromptRequest => ({
    text,
    agentId: activeAgent.id,
    mode,
    mentions: overrides?.mentions ?? chips.map((chip) => chip.mention),
    images: overrides?.images ?? imageAttachments,
  });

  const clearComposerAttachments = () => {
    setChips([]);
    setImageAttachments([]);
  };
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
    const overlayOpen = mentionOpen || slashOpen;
    const scrollDelta = overlayOpen
      ? null
      : resolveStreamScrollDelta(
          { upArrow: key.upArrow, downArrow: key.downArrow, pageUp: key.pageUp, pageDown: key.pageDown, shift: key.shift, ctrl: key.ctrl, meta: key.meta, input },
          { bodyHeight, maxOffset },
          effectiveOffset,
        );
    if (scrollDelta !== null) {
      setScrollOffset(applyStreamScrollDelta(effectiveOffset, scrollDelta, maxOffset));
      return;
    }
    if (key.ctrl && input === "c") {
      if (activeRunId) {
        const sent = stream.cancelRun?.(activeRunId) ?? false;
        appendSystem(sent ? "[cancel requested]" : "[cancel unavailable: stream is not connected]");
        return;
      }
      if (isStartingRun) {
        cleanupController.cancelPendingStartRef.current = true;
        appendSystem("[cancel requested once the run starts]");
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

  const dispatchPrompt = (request: PromptRequest, userDisplay?: string) => {
    const promptText = request.text.trim();
    if (promptText.length === 0 && request.images.length === 0) return;
    if (busy) {
      if (queueRef.current.length >= MAX_QUEUED_PROMPTS) {
        appendError(`Queue is full (${MAX_QUEUED_PROMPTS} prompts). Wait for the current run to finish, then try again.`);
        return;
      }
      const queued: QueuedPrompt = userDisplay === undefined ? { request } : { request, userDisplay };
      queueRef.current = [...queueRef.current, queued];
      setQueuedPrompts(queueRef.current);
      clearComposerAttachments();
      appendSystem(`queued: ${userDisplay ?? request.text}`);
      return;
    }
    startPrompt(request, userDisplay);
  };

  const submitPrompt = (text: string) => {
    setSlashDismissed(false);
    void (async () => {
      const slash = parseSlashCommand(text);
      if (slash?.command === "unknown" && slash.args[0]) {
        const skill = await resolveSkillBySlashCommand(slash.args[0], workspace);
        if (skill) {
          const body = await readSkillBody(skill.filePath);
          const args = slash.args.slice(1);
          const prompt = buildSkillInvocationPrompt(skill, body, args);
          const display = `/${skill.name}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;
          clearComposerAttachments();
          dispatchPrompt(promptSnapshot(prompt, { mentions: [], images: [] }), display);
          return;
        }
      }
      if (slash) {
        clearComposerAttachments();
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
          clearComposerAttachments,
        }).catch((error: unknown) => {
          appendError(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      const promptText = text.trim();
      if (promptText.length === 0 && imageAttachments.length === 0) return;
      dispatchPrompt(promptSnapshot(promptText.length > 0 ? promptText : "(see attached image)"));
    })().catch((error: unknown) => {
      appendError(error instanceof Error ? error.message : String(error));
    });
  };

  const handleImageDrop = (paths: string[]) => {
    const selected = selectImageDropPaths(paths, imageAttachments.length);
    if (selected.selected.length === 0) {
      if (selected.skippedCount > 0) appendSystem(`At most ${MAX_IMAGE_ATTACHMENTS} images per message.`);
      return;
    }
    if (selected.skippedCount > 0) {
      appendSystem(`At most ${MAX_IMAGE_ATTACHMENTS} images per message.`);
    }
    void Promise.allSettled(selected.selected.map((filePath) => readImageFromPath(filePath))).then((results) => {
      if (cleanupController.disposedRef.current) return;
      const loaded: ImageAttachment[] = [];
      const failures: string[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") loaded.push(result.value);
        else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
      if (loaded.length === 0) {
        appendError(formatImageDropFailure(results));
        return;
      }
      setImageAttachments((current) => mergeImageAttachments(current, loaded));
      if (failures.length > 0) {
        appendError(`Could not attach ${failures.length} dropped image${failures.length === 1 ? "" : "s"}: ${failures.join("; ")}`);
      }
    });
  };

  const startQueuedPrompt = () => {
    const next = queueRef.current[0];
    if (next === undefined) return;
    queueRef.current = queueRef.current.slice(1);
    setQueuedPrompts(queueRef.current);
    setTimeout(() => {
      if (!cleanupController.disposedRef.current) startPrompt(next.request, next.userDisplay);
    }, 0);
  };

  const startPrompt = (request: PromptRequest, userDisplay?: string) => {
    if (cleanupController.disposedRef.current) return;
    setIsStartingRun(true);
    setStreamStatus("connecting");
    if (effectiveOffset === 0) setScrollOffset(0);
    appendPromptHistory(request.text).catch((error: unknown) => {
      appendError(`Prompt history was not saved: ${error instanceof Error ? error.message : String(error)}`);
    });
    const userLine = request.images.length > 0
      ? `${userDisplay ?? request.text}${(userDisplay ?? request.text).length > 0 ? " " : ""}[${request.images.length} image${request.images.length === 1 ? "" : "s"}]`
      : (userDisplay ?? request.text);
    appendUser(userLine);
    void http.createRun({
      agentId: request.agentId,
      prompt: request.text,
      executionMode: request.mode,
      mentions: request.mentions,
      ...(request.images.length > 0 ? { images: attachmentImages(request.images) } : {}),
    }).then((run) => {
      if (cleanupController.disposedRef.current) return;
      clearComposerAttachments();
      let runFinished = false;
      const finishRun = () => {
        if (runFinished) return;
        runFinished = true;
        toolStartRef.current = null;
        setActiveRunId(null);
        setAgentTurnActive(false);
        setPendingApproval(null);
        setStreamStatus("ready");
        startQueuedPrompt();
      };
      setIsStartingRun(false);
      setActiveRunId(run.runId);
      setAgentTurnActive(true);
      setStreamStatus("connected");
      const subscription = stream.subscribeToRun(run.runId, (frame: ServerFrame) => {
        trackToolStart(frame, toolStartRef);
        setBuffer((current) => ingestStreamFrame(current, frame, workspace));
        if (frame.type === "sdk.request") setPendingApproval({ runId: run.runId, requestId: frame.event.payload.request_id });
        if (isRunStatusTerminalFrame(frame)) {
          toolStartRef.current = null;
          setAgentTurnActive(false);
          setPendingApproval(null);
          setStreamStatus("ready");
        }
        if (isTerminalFrame(frame)) {
          if (frame.type === "run.final_result") {
            const usage = frame.event.payload.usage;
            setSessionCost((current) => addSessionCost(current, usage));
            setSessionTokens((current) => addSessionTokens(current, usage));
          } else if (frame.type === "run.interrupted") {
            // ASSUMPTION: Interrupted runs can have unreported billable usage; flag
            // the session totals as partial rather than displaying exact zeros.
            // Flag if wrong.
            setSessionCost(markSessionCostUnavailable);
            setSessionTokens(markSessionTokensUnavailable);
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
        toolStartRef.current = null;
        setStreamStatus("disconnected");
        appendError(error instanceof Error ? error.message : String(error));
        startQueuedPrompt();
      });
      if (cleanupController.cancelPendingStartRef.current) {
        const sent = stream.cancelRun?.(run.runId) ?? false;
        cleanupController.cancelPendingStartRef.current = false;
        appendSystem(sent ? "[cancel requested]" : "[cancel unavailable: stream is not connected]");
      }
    }).catch((error: unknown) => {
      if (cleanupController.disposedRef.current) return;
      setIsStartingRun(false);
      setActiveRunId(null);
      setAgentTurnActive(false);
      setPendingApproval(null);
      toolStartRef.current = null;
      cleanupController.cancelPendingStartRef.current = false;
      setStreamStatus("disconnected");
      appendError(error instanceof Error ? error.message : String(error));
      startQueuedPrompt();
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
        if (cleanupController.disposedRef.current || mentionRequestSeqRef.current !== seq) return;
        const visibleCount = Math.min(MAX_MENTION_ITEMS, flattenMentionResults(result).length);
        setMentionResults(result);
        setMentionIndex((current) => clampSelectionIndex(current, visibleCount));
      }).catch((error: unknown) => {
        if (cleanupController.disposedRef.current || mentionRequestSeqRef.current !== seq) return;
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
        cwdBase={cwdBase}
        modelId={modelId}
        accountLabel={accountLabel}
        chromeState={chromeState}
        queuedPrompts={queuedPrompts.length}
        theme={theme}
      />
      <Box flexDirection="column" height={layout.scrollHeight} borderStyle="round" {...border(theme.border)} paddingX={1} {...bg(theme.panel)}>
        <StreamView items={buffer.items} height={streamHeight} width={streamWidth} scrollOffset={effectiveOffset} activeLabel={activeLabel} activeLabelSegments={activeLabelSegments} viewportState={streamViewport} theme={theme} />
      </Box>
      {mentionOpen ? <MentionPopup results={mentionResults} selectedIndex={mentionIndex} open={mentionOpen} focused={inputFocused} theme={theme} /> : null}
      {!mentionOpen && slashOpen ? <SlashPalette items={slashItems} selectedIndex={slashIndex} focused={inputFocused} theme={theme} /> : null}
      <InputBar
        chips={chips}
        imageAttachments={imageAttachments}
        history={history}
        mentionItems={mentionItems}
        selectedMentionIndex={mentionIndex}
        slashItems={slashOpen ? slashItems : []}
        selectedSlashIndex={slashIndex}
        width={layout.columns}
        maxVisibleLines={Math.max(1, Math.min(MAX_INPUT_VISIBLE_LINES, layout.inputHeight - 2))}
        streamScrollActive={streamScrollActive}
        theme={theme}
        onMentionNavigate={(delta) => setMentionIndex((current) => moveMentionSelection(current, delta, mentionItems.length))}
        onMentionDismiss={clearMentionState}
        onMentionSelect={(nextChips) => {
          setChips(nextChips);
          clearMentionState();
        }}
        focused={inputFocused}
        onSlashNavigate={(delta) => setSlashIndex((current) => moveMentionSelection(current, delta, slashItems.length))}
        onSlashSelect={() => setSlashDismissed(true)}
        onSubmit={submitPrompt}
        onChange={handleInputChange}
        onClear={() => setInputDraft("")}
        onImageDrop={handleImageDrop}
        onRemoveLastImage={() => setImageAttachments((current) => current.slice(0, -1))}
        onEscape={() => {
          setSlashDismissed(true);
          clearMentionState();
        }}
      />
      <StatusBar
        sessionCost={sessionCost}
        sessionTokens={sessionTokens}
        streamScrollActive={streamScrollActive}
        width={layout.columns}
        theme={theme}
      />
    </Box>
  );
}

function TooSmallTerminal({ columns, rows, theme }: { columns: number; rows: number; theme: ReturnType<typeof createTuiTheme> }) {
  return (
    <Box flexDirection="column" paddingX={1} {...bg(theme.background)}>
      <Text {...fg(theme.brand)}>Cursor Harness</Text>
      <Text {...fg(theme.state?.error)}>terminal too small: {columns}x{rows}</Text>
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
  clearComposerAttachments: () => void;
}

async function handleSlashCommand(ctx: SlashCommandContext): Promise<void> {
  const { slash, setBuffer } = ctx;
  const appendMessage = (message: string) => setBuffer((current) => ({ items: [...current.items, { type: "system", text: message }] }));
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
      ctx.clearComposerAttachments();
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
    case "skill":
      await handleSkillSlash(slash.args, ctx, appendMessage, appendError);
      return;
    case "unknown":
      appendError("Unknown slash command. Use /skill list to see skills, or invoke one with /skill-name.");
      return;
  }
}

function clearMentionTimer(ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (ref.current) clearTimeout(ref.current);
  ref.current = null;
}

function trackToolStart(frame: ServerFrame, ref: React.MutableRefObject<{ callId: string; startMs: number } | null>): void {
  if (frame.type !== "sdk.tool_call") return;
  const payload = frame.event.payload;
  if (payload.status === "running") {
    if (ref.current?.callId !== payload.call_id) ref.current = { callId: payload.call_id, startMs: Date.now() };
  } else if (ref.current?.callId === payload.call_id) {
    ref.current = null;
  }
}

function findRunningTool(items: readonly StreamItem[], callId: string): Extract<StreamItem, { type: "tool" }> | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "tool" && item.callId === callId) return item.status === "running" ? item : undefined;
  }
  return undefined;
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

async function handleSkillSlash(
  args: string[],
  ctx: SlashCommandContext,
  appendMessage: (message: string) => void,
  appendError: (message: string) => void,
): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "list") {
    const skills = await listSkills({ workspace: ctx.workspace });
    if (skills.length === 0) {
      appendMessage("No skills found in this workspace or ~/.cursor/skills.");
      return;
    }
    appendMessage(skills.map((skill) => `${skill.scope}:${skill.name} · ${skill.description}`).join("\n"));
    return;
  }
  if (subcommand === "create") {
    const name = args[1];
    const description = args.slice(2).join(" ").trim();
    if (!name || description.length === 0) {
      appendError("Usage: /skill create <name> <description>");
      return;
    }
    try {
      const created = await createSkill({ name, description, workspace: ctx.workspace });
      appendMessage(`Skill created at ${created.filePath}`);
    } catch (error: unknown) {
      appendError(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  appendError("Usage: /skill create <name> <description> | /skill list");
}

function cliAgentFromSummary(agent: Pick<AgentSummary, "id" | "name" | "modelId" | "executionMode">): CliAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    modelId: agent.modelId,
    executionMode: agent.executionMode === "ask" ? "ask" : "agent",
  };
}

export interface ChromeStateInput {
  streamStatus: StreamConnectionStatus;
  turnActive: boolean;
  busy: boolean;
  toolRunning: boolean;
  lastItemType?: StreamItem["type"] | undefined;
}

export function deriveChromeState(input: ChromeStateInput): ChromeState {
  if (input.streamStatus === "disconnected") return "disconnected";
  if (!input.turnActive && input.lastItemType === "error") return "error";
  if (input.toolRunning) return "tool-running";
  if (input.turnActive || input.busy) return "streaming";
  return "ready";
}

export function addSessionCost(current: SessionCostState, usage: TokenUsage): SessionCostState {
  if (usage.usage_source === "unavailable" || usage.cost_usd_micros === null) return markSessionCostUnavailable(current);
  return { ...current, micros: current.micros + usage.cost_usd_micros };
}

export function markSessionCostUnavailable(current: SessionCostState): SessionCostState {
  return { ...current, hasUnavailableTurn: true };
}

export function addSessionTokens(current: SessionTokenState, usage: TokenUsage): SessionTokenState {
  if (usage.usage_source === "unavailable" || (usage.input_tokens === null && usage.output_tokens === null)) {
    return { ...current, hasUnavailableTurn: true };
  }
  const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  return {
    tokens: current.tokens + tokens,
    hasUnavailableTurn: current.hasUnavailableTurn || usage.input_tokens === null || usage.output_tokens === null,
  };
}

export function markSessionTokensUnavailable(current: SessionTokenState): SessionTokenState {
  return { ...current, hasUnavailableTurn: true };
}

function createEmptySessionCost(): SessionCostState {
  return { micros: 0, hasUnavailableTurn: false };
}

function createEmptySessionTokens(): SessionTokenState {
  return { tokens: 0, hasUnavailableTurn: false };
}

function safeProcessCwd(fallback: string): string {
  try {
    return process.cwd();
  } catch {
    return fallback;
  }
}
