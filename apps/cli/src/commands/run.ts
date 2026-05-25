import type { ContextMention, CreateRunRequest, ServerFrame } from "@harness/shared";
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
    if (!deps.stream) return 0;

    let buffer = createStreamBuffer();
    await deps.stream.subscribeToRun(run.runId, (frame: ServerFrame) => {
      if (options.json) {
        writeJsonLine(deps.write, frame);
        return;
      }
      buffer = ingestStreamFrame(buffer, frame);
      deps.write(renderStreamItems(buffer.items));
    });
    return 0;
  } catch (error) {
    if (error instanceof CliHttpError && error.code === "NETWORK_ERROR") {
      deps.writeError?.(`Cannot connect to harness server. Start it with: pnpm start:server`);
      return 2;
    }
    deps.writeError?.(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
