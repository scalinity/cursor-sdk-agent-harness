import type { ContextMention, CreateRunRequest, RunSummary, ServerFrame } from "@harness/shared";
import { writeJsonLine } from "../output/json.js";
import { CliHttpError } from "../client/http.js";
import { createStreamBuffer, ingestStreamFrame, renderStreamItems } from "../repl/StreamView.js";
import type { CliMode, CommandDeps } from "../types.js";

export interface RunCommandOptions {
  prompt: string;
  agent?: string;
  mode?: CliMode;
  model?: string;
  workspace?: string;
  json?: boolean;
  noStream?: boolean;
  timeout?: number;
  approve?: boolean;
  mentions?: ContextMention[];
}

export async function runPrompt(options: RunCommandOptions, deps: CommandDeps): Promise<number> {
  const timeoutMs = normalizeTimeout(options.timeout);
  try {
    await deps.http.ensureCsrfToken();
    const agentInput: { agentId?: string; model?: string; mode?: CliMode; workspace?: string } = {};
    if (options.agent !== undefined) agentInput.agentId = options.agent;
    if (options.model !== undefined) agentInput.model = options.model;
    if (options.mode !== undefined) agentInput.mode = options.mode;
    if (options.workspace !== undefined) agentInput.workspace = options.workspace;
    const agent = await deps.http.getOrCreateAgent(agentInput);
    const body: CreateRunRequest = {
      agentId: agent.id,
      prompt: options.prompt,
      executionMode: options.mode ?? agent.executionMode ?? "agent",
      ...(options.mentions && options.mentions.length > 0 ? { mentions: options.mentions } : {}),
    };
    const run = await deps.http.createRun(body);
    if (options.json) writeJsonLine(deps.write, { type: "run_started", runId: run.runId, agentId: run.agentId, status: run.status });
    if (options.approve && !options.json) {
      deps.writeError?.("Warning: --approve will approve every approval prompt for this run.");
    }

    let buffer = createStreamBuffer();
    let rendered = "";
    const ingest = (frame: ServerFrame) => {
      if (frame.type === "sdk.request") {
        deps.stream?.sendApproval?.(
          run.runId,
          frame.event.payload.request_id,
          options.approve ? "approve" : "deny",
          options.approve ? "approved by --approve" : "denied by default in one-shot mode",
        );
      }
      buffer = ingestStreamFrame(buffer, frame, options.workspace);
      if (options.json) {
        writeJsonLine(deps.write, frame);
        return;
      }
      if (!options.noStream) {
        rendered = writeIncremental(rendered, renderStreamItems(buffer.items), deps);
      }
    };

    if (deps.stream) {
      await withTimeout(
        deps.stream.subscribeToRun(run.runId, ingest),
        timeoutMs,
        () => {
          deps.stream?.cancelRun?.(run.runId);
          deps.stream?.close?.();
        },
      );
    } else {
      buffer = await waitForRunViaRest(run.runId, timeoutMs, deps, options.workspace);
    }

    if (options.noStream && !options.json) {
      deps.write(renderStreamItems(buffer.items));
    }
    return 0;
  } catch (error) {
    if (error instanceof RunTimeoutError) {
      deps.writeError?.(`Run timed out after ${timeoutMs}ms.`);
      return 1;
    }
    if (error instanceof CliHttpError && error.code === "NETWORK_ERROR") {
      deps.writeError?.(`Cannot connect to harness server. Start it with: pnpm start:server`);
      return 2;
    }
    deps.writeError?.(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

class RunTimeoutError extends Error {
  constructor() {
    super("Run timed out");
    this.name = "RunTimeoutError";
  }
}

function normalizeTimeout(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : 300_000;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          onTimeout();
          reject(new RunTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForRunViaRest(runId: string, timeoutMs: number, deps: CommandDeps, cwd?: string) {
  const started = Date.now();
  for (;;) {
    const run: RunSummary = await deps.http.getRun(runId);
    if (isTerminalStatus(run.status)) break;
    if (Date.now() - started > timeoutMs) throw new RunTimeoutError();
    await delay(250);
  }

  let buffer = createStreamBuffer();
  let afterSeq = 0;
  for (;;) {
    const page = await deps.http.getRunEvents(runId, { afterSeq, limit: 500, direction: "asc" });
    for (const frame of page.items) {
      buffer = ingestStreamFrame(buffer, frame, cwd);
      const seq = "event" in frame ? frame.event.seq : afterSeq;
      afterSeq = Math.max(afterSeq, seq);
    }
    if (page.nextAfterSeq === null) break;
    afterSeq = page.nextAfterSeq;
  }
  return buffer;
}

function writeIncremental(previous: string, next: string, deps: CommandDeps): string {
  if (next === previous) return previous;
  const writeRaw = deps.writeRaw ?? ((text: string) => deps.write(text));
  if (next.startsWith(previous)) {
    writeRaw(next.slice(previous.length));
    return next;
  }
  const previousLines = previous.split("\n").length;
  writeRaw(next.split("\n").slice(previousLines).join("\n"));
  return next;
}

function isTerminalStatus(status: string): boolean {
  return status === "FINISHED" || status === "ERROR" || status === "CANCELLED" || status === "EXPIRED";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
