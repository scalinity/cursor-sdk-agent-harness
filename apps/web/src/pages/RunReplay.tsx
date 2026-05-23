import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReplaySpeed } from "@harness/shared";
import { useRunReplay } from "../hooks/useRunReplay.js";
import { useRunSummary } from "../hooks/useRunSummary.js";
import { useSettings } from "../hooks/useSettings.js";
import { formatDuration, formatMicros, formatRelativeTime, formatTokens, tokenTotal } from "../lib/format.js";
import { Titlebar } from "../components/shell/Titlebar.js";
import { EventTimeline } from "../components/shell/EventTimeline.js";
import { RightPane } from "../components/shell/RightPane.js";
import { Statusbar } from "../components/shell/Statusbar.js";
import { StreamingSurfaceBoundary } from "../components/streaming/StreamingSurfaceBoundary.js";
import { RunStatusPill } from "../components/streaming/RunStatusPill.js";

const SPEEDS: ReplaySpeed[] = ["instant", "1x", "2x", "4x"];

function eventHasError(event: { kind: string; payload: unknown }): boolean {
  if (event.kind.toLowerCase().includes("error")) return true;
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return false;
  const record = event.payload as Record<string, unknown>;
  return record.status === "error" || record.status === "ERROR";
}

export function RunReplay() {
  const { runId = "" } = useParams();
  const [speed, setSpeed] = useState<ReplaySpeed>("2x");
  const [paused, setPaused] = useState(false);
  const [targetSeq, setTargetSeq] = useState(0);
  const summary = useRunSummary(runId || null);
  useSettings();
  const replay = useRunReplay({ runId, speed, paused, startFromSeq: targetSeq });
  const maxSeq = replay.allEvents.at(-1)?.seq ?? summary.run?.toolCallCount ?? 0;
  const usageUnavailable = summary.run?.usageSource === "unavailable" || replay.allEvents.some((event) => {
    if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return false;
    return (event.payload as Record<string, unknown>).usage_source === "unavailable";
  });

  const jumpTargets = useMemo(() => {
    const error = replay.allEvents.find(eventHasError)?.seq ?? null;
    const tool = replay.allEvents.find((event) => event.seq > replay.currentSeq && event.sdk_type === "tool_call")?.seq
      ?? replay.allEvents.find((event) => event.sdk_type === "tool_call")?.seq
      ?? null;
    const finalUsage = replay.allEvents.find((event) => event.kind === "run.final_result")?.seq ?? null;
    return { error, tool, finalUsage };
  }, [replay.allEvents, replay.currentSeq]);

  const jumpTo = (seq: number | null) => {
    if (seq === null) return;
    setPaused(true);
    setTargetSeq(seq);
  };

  const step = (direction: -1 | 1) => {
    const currentIndex = replay.allEvents.findIndex((event) => event.seq >= replay.currentSeq);
    const nextIndex = direction > 0 ? Math.min(replay.allEvents.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
    const nextSeq = replay.allEvents[nextIndex]?.seq ?? 0;
    setPaused(true);
    setTargetSeq(nextSeq);
  };

  const totalTokens = summary.run ? tokenTotal(summary.run.inputTokens, summary.run.outputTokens) : null;

  return (
    <div className="app-grid">
      <Titlebar />
      <aside className="sessions-rail p-3">
        <Link className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-sm text-text-secondary hover:bg-surface-1" to="/runs">Back to history</Link>
        <div className="mt-4 grid gap-3 text-sm text-text-secondary">
          <div>
            <div className="text-xs uppercase tracking-uppercase text-text-tertiary">Run</div>
            <div className="mono mt-1 truncate text-text-primary" title={runId}>{runId}</div>
          </div>
          {summary.run ? (
            <>
              <RunStatusPill runId={summary.run.id} status={summary.run.status} />
              <div>
                <div className="text-xs uppercase tracking-uppercase text-text-tertiary">Agent</div>
                <div className="mt-1 truncate text-text-primary">{summary.run.agentName ?? summary.run.agentId}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-uppercase text-text-tertiary">Model</div>
                <div className="mono mt-1 truncate text-text-primary">{summary.run.modelId ?? "--"}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 mono text-xs">
                <span>Duration</span><span className="text-right text-text-primary">{formatDuration(summary.run.durationMs)}</span>
                <span>Cost</span><span className="text-right text-text-primary">{summary.run.usageSource === "unavailable" ? "--" : formatMicros(summary.run.costUsdMicros)}</span>
                <span>Tokens</span><span className="text-right text-text-primary">{summary.run.usageSource === "unavailable" ? "--" : formatTokens(totalTokens)}</span>
              </div>
            </>
          ) : null}
          <a className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-center text-sm text-text-secondary hover:bg-surface-1" href={`/api/runs/${encodeURIComponent(runId)}/transcript?format=json`} download>Download JSON</a>
          <a className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-center text-sm text-text-secondary hover:bg-surface-1" href={`/api/runs/${encodeURIComponent(runId)}/transcript?format=markdown`} download>Download Markdown</a>
        </div>
      </aside>

      <main className="center-pane">
        <div className="center-head justify-between">
          <div className="min-w-0 truncate">
            <span className="font-semibold">Replaying run</span>
            <span className="ml-2 text-text-tertiary">from {summary.run ? formatRelativeTime(summary.run.startedAt) : "--"} - {formatTokens(replay.allEvents.length)} events</span>
            {usageUnavailable ? <span className="ml-2 text-warning">usage unavailable or partial</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={() => setPaused((value) => !value)}>{paused ? "Play" : "Pause"}</button>
            <select className="h-control-md rounded-sm border border-border-subtle bg-background px-2 text-sm text-text-secondary" value={speed} onChange={(event) => setSpeed(event.currentTarget.value as ReplaySpeed)}>
              {SPEEDS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>
        <div className="border-b border-border-subtle bg-surface-1 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={() => step(-1)} disabled={replay.currentSeq <= 0}>Step back</button>
            <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={() => step(1)} disabled={replay.currentSeq >= maxSeq}>Step forward</button>
            <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={() => jumpTo(jumpTargets.error)} disabled={jumpTargets.error === null}>Jump error</button>
            <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={() => jumpTo(jumpTargets.tool)} disabled={jumpTargets.tool === null}>Jump tool</button>
            <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={() => jumpTo(jumpTargets.finalUsage)} disabled={jumpTargets.finalUsage === null}>Jump final usage</button>
            <span className="mono ml-auto text-xs text-text-tertiary">seq {replay.currentSeq} / {maxSeq}</span>
          </div>
          <input className="mt-2 block w-full" type="range" min={0} max={Math.max(0, maxSeq)} value={Math.min(replay.currentSeq, Math.max(0, maxSeq))} onChange={(event) => jumpTo(Number(event.currentTarget.value))} />
        </div>
        <div className="center-scroll">
          {summary.error || replay.error ? <div className="mb-3 border border-danger bg-danger-bg p-3 text-sm text-danger">{summary.error ?? replay.error}</div> : null}
          {summary.loading || replay.loading ? <div className="mb-3 border border-border-subtle bg-surface-1 p-3 text-sm text-text-tertiary">Loading replay...</div> : null}
          <StreamingSurfaceBoundary surface="replay-chat-timeline">
            <EventTimeline runId={runId} />
          </StreamingSurfaceBoundary>
        </div>
      </main>
      <RightPane activeRunId={runId} />
      <Statusbar connectionState="closed" modelLabel={summary.run?.modelId ?? null} runningRunId={null} />
    </div>
  );
}
