import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RunSummary, SdkRunStatus } from "@harness/shared";
import { useAgents } from "../hooks/useAgents.js";
import { useRunHistory, type RunHistoryCostFilter, type RunHistorySort } from "../hooks/useRunHistory.js";
import { useRunSearch } from "../hooks/useRunSearch.js";
import { useSettings } from "../hooks/useSettings.js";
import { dateRangeForPreset, formatDuration, formatMicros, formatRelativeTime, formatTokens, isoDateInput, tokenTotal } from "../lib/format.js";
import { RunHistoryRow } from "../components/history/RunHistoryRow.js";
import { RunStatusPill } from "../components/streaming/RunStatusPill.js";
import { Select } from "../components/ui/Select.js";

const STATUSES: SdkRunStatus[] = ["CREATING", "RUNNING", "FINISHED", "ERROR", "CANCELLED", "EXPIRED"];
const SORTS: Array<{ value: RunHistorySort; label: string }> = [
  { value: "started_desc", label: "Started desc" },
  { value: "started_asc", label: "Started asc" },
  { value: "duration_desc", label: "Duration desc" },
  { value: "duration_asc", label: "Duration asc" },
  { value: "cost_desc", label: "Cost desc" },
  { value: "cost_asc", label: "Cost asc" },
  { value: "tokens_desc", label: "Tokens desc" },
  { value: "tokens_asc", label: "Tokens asc" },
];
const COST_FILTERS: Array<{ value: RunHistoryCostFilter; label: string }> = [
  { value: "any", label: "Any cost" },
  { value: "available", label: "Has cost" },
  { value: "unavailable", label: "Usage unavailable" },
  { value: "none", label: "No data" },
];

type RangePreset = "24h" | "7d" | "30d" | "custom";

/**
 * SafeSnippet — renders an FTS snippet string that contains `<mark>` tags as
 * safe React elements. All other text is HTML-escaped by React's default
 * text-node rendering, eliminating XSS risk from user-controlled content.
 */
function SafeSnippet({ html }: { html: string }) {
  // Split on <mark> and </mark> tags, preserving them as delimiters.
  const parts = html.split(/(<\/?mark>)/);
  const elements: React.ReactNode[] = [];
  let inMark = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "<mark>") {
      inMark = true;
      continue;
    }
    if (part === "</mark>") {
      inMark = false;
      continue;
    }
    if (part.length === 0) continue;
    elements.push(
      inMark ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
    );
  }
  return <>{elements}</>;
}

function listParam(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function setListParam(next: URLSearchParams, key: string, values: string[]): void {
  if (values.length > 0) next.set(key, values.join(","));
  else next.delete(key);
}

/** Add/remove `value` from the comma-list at `key`, preserving order-as-set. */
function toggleListParam(next: URLSearchParams, key: string, current: string[], value: string): void {
  const values = new Set(current);
  if (values.has(value)) values.delete(value);
  else values.add(value);
  setListParam(next, key, [...values]);
}

function isStatus(value: string): value is SdkRunStatus {
  return STATUSES.includes(value as SdkRunStatus);
}

/** Filter-chip className: highlighted when active, bordered when not. `mono`
 *  prefix is opt-in for chips that show identifiers (model ids). */
function chipClass(active: boolean, mono = false): string {
  const base = active
    ? "h-control-md rounded-sm bg-accent-bg px-3 text-sm text-accent-primary"
    : "h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary";
  return mono ? `mono ${base}` : base;
}

function rowCost(run: RunSummary): string {
  if (run.usageSource === "unavailable") return "--";
  return formatMicros(run.costUsdMicros);
}

function rowTokens(run: RunSummary): string {
  if (run.usageSource === "unavailable") return "--";
  return formatTokens(tokenTotal(run.inputTokens, run.outputTokens));
}

function rowCacheRate(run: RunSummary): string {
  if (run.inputTokens === null || run.inputTokens === 0) return "--";
  const cached = run.cachedInputTokens ?? 0;
  return `${((100 * cached) / run.inputTokens).toFixed(0)}%`;
}

function VirtualRunRow({ run, selected, onToggleSelected, onFilterAgent }: {
  run: RunSummary;
  selected: boolean;
  onToggleSelected: (runId: string) => void;
  onFilterAgent: (agentId: string) => void;
}) {
  const title = run.promptPreview.length > 80 ? `${run.promptPreview.slice(0, 80)}...` : run.promptPreview;
  return (
    <div className="grid grid-cols-12 items-center gap-2 border-b border-border-subtle px-2 py-2 text-sm hover:bg-surface-2">
      <label className="col-span-1 flex items-center">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelected(run.id)} aria-label={`Select ${run.id}`} />
      </label>
      <div className="col-span-2"><RunStatusPill runId={run.id} status={run.status} /></div>
      <Link className="col-span-3 truncate text-text-primary hover:text-accent-primary" to={`/runs/${run.id}/replay`} title={run.promptPreview}>{title || run.id}</Link>
      <button className="col-span-1 truncate text-left text-text-secondary hover:text-accent-primary" type="button" onClick={() => onFilterAgent(run.agentId)}>{run.agentName ?? run.agentId}</button>
      <div className="mono col-span-1 truncate text-text-secondary">{run.modelId ?? "--"}</div>
      <div className="col-span-1 text-text-secondary" title={run.startedAt}>{formatRelativeTime(run.startedAt)}</div>
      <div className="mono col-span-1 text-text-secondary">{formatDuration(run.durationMs)}</div>
      <div className="mono col-span-1 text-text-secondary">
        {formatTokens(run.toolCallCount)}
        {run.errorToolCallCount > 0 ? <span className="ml-2 rounded-sm bg-danger-bg px-1 text-danger">{run.errorToolCallCount}</span> : null}
      </div>
      <div className="mono col-span-1 text-text-secondary">{rowCost(run)}</div>
      <div className="mono col-span-1 text-text-secondary">{rowTokens(run)}</div>
      <div className="mono col-span-1 text-text-secondary">{rowCacheRate(run)}</div>
    </div>
  );
}

export function RunHistory() {
  const [params, setParams] = useSearchParams();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const search = useRunSearch(searchQuery);
  const isSearchActive = searchQuery.length >= 2;
  const selectedAgents = listParam(params, "agents");
  const selectedStatuses = listParam(params, "status").filter(isStatus);
  const selectedModels = listParam(params, "models");
  const preset = (params.get("range") as RangePreset | null) ?? "7d";
  const cost = (params.get("hasCost") as RunHistoryCostFilter | null) ?? "any";
  const sort = (params.get("sort") as RunHistorySort | null) ?? "started_desc";
  const page = Number(params.get("page") ?? "1");
  const defaultRange = useMemo(() => dateRangeForPreset("7d"), []);
  const from = params.get("from") ?? defaultRange.from.toISOString();
  const to = params.get("to") ?? defaultRange.to.toISOString();
  const { agents } = useAgents();
  useSettings();
  const history = useRunHistory({
    agentId: selectedAgents,
    status: selectedStatuses,
    modelId: selectedModels,
    from,
    to,
    hasCost: cost,
    sort,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 500,
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const totalPages = Math.max(1, Math.ceil(history.total / 500));
  const virtualizer = useVirtualizer({
    count: history.runs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 12,
  });
  const setVirtualSpacer = (node: HTMLDivElement | null) => {
    if (node) node.style.height = `${virtualizer.getTotalSize()}px`;
  };
  const setVirtualRow = (node: HTMLDivElement | null, start: number) => {
    if (node) node.style.transform = `translateY(${start}px)`;
  };

  const modelOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const run of history.runs) {
      if (run.modelId) ids.add(run.modelId);
    }
    for (const model of selectedModels) ids.add(model);
    return [...ids].sort();
  }, [history.runs, selectedModels]);

  const updateParams = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.set("page", "1");
    setParams(next);
  };

  const toggleSelection = (runId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const selectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = history.runs.every((run) => next.has(run.id));
      for (const run of history.runs) {
        if (allSelected) next.delete(run.id);
        else next.add(run.id);
      }
      return next;
    });
  };

  const applyPreset = (nextPreset: Exclude<RangePreset, "custom">) => {
    const range = dateRangeForPreset(nextPreset);
    updateParams((next) => {
      next.set("range", nextPreset);
      next.set("from", range.from.toISOString());
      next.set("to", range.to.toISOString());
    });
  };

  const selectedIds = [...selected];

  return (
    <main className="min-h-screen bg-background p-4 text-text-primary">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <div>
            <h1 className="text-2xl font-semibold">Run History</h1>
            <p className="text-sm text-text-tertiary">Completed and active runs with replay, transcript export, cost, and token totals.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-sm text-text-secondary hover:bg-surface-1" to="/usage">Usage</Link>
            <Link className="h-control-md rounded-sm border border-border-subtle px-3 py-1 text-sm text-text-secondary hover:bg-surface-1" to="/chat">Chat</Link>
          </div>
        </header>

        <section className="grid gap-3 border border-border-subtle bg-surface-1 p-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="h-control-md flex-1 rounded-sm border border-border-subtle bg-background px-2 text-sm text-text-primary placeholder:text-text-tertiary"
              placeholder="Search runs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery.length > 0 ? (
              <button type="button" className="text-text-tertiary hover:text-text-primary" onClick={() => setSearchQuery("")} aria-label="Clear search">✕</button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["24h", "7d", "30d"].map((value) => (
              <button key={value} className={chipClass(preset === value)} type="button" onClick={() => applyPreset(value as Exclude<RangePreset, "custom">)}>{value}</button>
            ))}
            <input className="h-control-md rounded-sm border border-border-subtle bg-background px-2 text-sm" type="date" value={isoDateInput(new Date(from))} onChange={(event) => updateParams((next) => { next.set("range", "custom"); next.set("from", `${event.currentTarget.value}T00:00:00.000Z`); })} />
            <input className="h-control-md rounded-sm border border-border-subtle bg-background px-2 text-sm" type="date" value={isoDateInput(new Date(to))} onChange={(event) => updateParams((next) => { next.set("range", "custom"); next.set("to", `${event.currentTarget.value}T23:59:59.999Z`); })} />
            <Select
              value={sort}
              options={SORTS}
              onChange={(value) => updateParams((next) => next.set("sort", value))}
              ariaLabel="Sort runs"
              className="h-control-md rounded-sm border border-border-subtle bg-background px-2 text-sm text-text-secondary"
            />
            <Select
              value={cost}
              options={COST_FILTERS}
              onChange={(value) => updateParams((next) => next.set("hasCost", value))}
              ariaLabel="Cost filter"
              className="h-control-md rounded-sm border border-border-subtle bg-background px-2 text-sm text-text-secondary"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => (
              <button key={agent.id} className={chipClass(selectedAgents.includes(agent.id))} type="button" onClick={() => updateParams((next) => toggleListParam(next, "agents", selectedAgents, agent.id))}>{agent.name}</button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <button key={status} className={chipClass(selectedStatuses.includes(status))} type="button" onClick={() => updateParams((next) => toggleListParam(next, "status", selectedStatuses, status))}>{status}</button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {modelOptions.map((model) => (
              <button key={model} className={chipClass(selectedModels.includes(model), true)} type="button" onClick={() => updateParams((next) => toggleListParam(next, "models", selectedModels, model))}>{model}</button>
            ))}
          </div>
        </section>

        <section className="border border-border-subtle bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle p-2 text-sm text-text-secondary">
            <span className="mono">{formatTokens(history.total)} runs</span>
            <div className="flex flex-wrap items-center gap-2">
              <button className="h-control-md rounded-sm border border-border-subtle px-3 text-sm text-text-secondary" type="button" onClick={selectPage}>Select page</button>
              {selectedIds.length > 0 ? (
                confirmingDelete ? (
                  <button className="h-control-md rounded-sm bg-danger-bg px-3 text-sm text-danger" type="button" onClick={() => { void history.deleteRuns(selectedIds).then(() => { setSelected(new Set()); setConfirmingDelete(false); }); }}>Confirm cascade delete {selectedIds.length}</button>
                ) : (
                  <button className="h-control-md rounded-sm border border-danger px-3 text-sm text-danger" type="button" onClick={() => setConfirmingDelete(true)}>Delete selected</button>
                )
              ) : null}
            </div>
          </div>

          {history.error ? <div className="border-b border-danger bg-danger-bg p-3 text-sm text-danger">{history.error}</div> : null}
          {history.loading && !isSearchActive ? <div className="p-4 text-sm text-text-tertiary">Loading runs...</div> : null}

          {isSearchActive ? (
            <div className="p-2">
              {search.isSearching ? <div className="p-2 text-sm text-text-tertiary">Searching...</div> : null}
              {!search.isSearching && search.results.length === 0 ? <div className="p-2 text-sm text-text-tertiary">No results found for &quot;{searchQuery}&quot;</div> : null}
              {search.results.map((r) => (
                <Link key={r.runId} to={`/runs/${r.runId}/replay`} className="flex flex-col gap-0.5 border-b border-border-subtle p-2 text-sm hover:bg-surface-2">
                  <span className="text-text-primary">{r.name ?? r.prompt}</span>
                  <span className="text-text-tertiary"><SafeSnippet html={r.snippet} /></span>
                </Link>
              ))}
            </div>
          ) : !history.loading && history.runs.length === 0 ? <div className="p-4 text-sm text-text-tertiary">No runs found. Try adjusting filters or start a new agent.</div> : null}

          {isSearchActive ? null : history.runs.length > 200 ? (
            <div ref={parentRef} className="run-history-virtual">
              <div className="grid grid-cols-12 gap-2 border-b border-border-subtle px-2 py-2 text-xs uppercase tracking-uppercase text-text-tertiary">
                <span className="col-span-1">Sel</span><span className="col-span-2">Status</span><span className="col-span-3">Title</span><span className="col-span-1">Agent</span><span className="col-span-1">Model</span><span className="col-span-1">Started</span><span className="col-span-1">Duration</span><span className="col-span-1">Tool calls</span><span className="col-span-1">Cost</span><span className="col-span-1">Tokens</span><span className="col-span-1">Cache</span>
              </div>
              <div ref={setVirtualSpacer} className="run-history-virtual__spacer">
                {virtualizer.getVirtualItems().map((item) => {
                  const run = history.runs[item.index]!;
                  return (
                    <div key={run.id} ref={(node) => setVirtualRow(node, item.start)} className="run-history-virtual__row">
                      <VirtualRunRow run={run} selected={selected.has(run.id)} onToggleSelected={toggleSelection} onFilterAgent={(agentId) => updateParams((next) => setListParam(next, "agents", [agentId]))} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : history.runs.length > 0 ? (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="text-left text-xs uppercase tracking-uppercase text-text-tertiary">
                  <tr>
                    <th className="p-2 font-medium">Sel</th><th className="p-2 font-medium">Status</th><th className="p-2 font-medium">Title</th><th className="p-2 font-medium">Agent</th><th className="p-2 font-medium">Model</th><th className="p-2 font-medium">Started</th><th className="p-2 font-medium">Duration</th><th className="p-2 font-medium">Tool calls</th><th className="p-2 font-medium">Cost</th><th className="p-2 font-medium">Tokens</th><th className="p-2 font-medium">Cache</th>
                  </tr>
                </thead>
                <tbody>
                  {history.runs.map((run) => <RunHistoryRow key={run.id} run={run} selected={selected.has(run.id)} onToggleSelected={toggleSelection} onFilterAgent={(agentId) => updateParams((next) => setListParam(next, "agents", [agentId]))} />)}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border-subtle p-2 text-sm text-text-secondary">
            <button className="h-control-md rounded-sm border border-border-subtle px-3 disabled:text-text-quaternary" type="button" disabled={page <= 1} onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set("page", String(Math.max(1, page - 1))); return next; })}>Prev</button>
            <span className="mono">Page {Math.min(page, totalPages)} / {totalPages}</span>
            <button className="h-control-md rounded-sm border border-border-subtle px-3 disabled:text-text-quaternary" type="button" disabled={page >= totalPages} onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set("page", String(page + 1)); return next; })}>Next</button>
          </div>
        </section>
      </div>
    </main>
  );
}
