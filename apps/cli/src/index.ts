#!/usr/bin/env node
import { stdin as input, stdout as output, stderr } from "node:process";
import { Command } from "commander";
import React from "react";
import { createAgent, listAgents } from "./commands/agents.js";
import { showHistory } from "./commands/history.js";
import { runPrompt } from "./commands/run.js";
import { searchWorkspace } from "./commands/search.js";
import { resolveCliBackend, type CliBackend } from "./backend.js";
import { DEFAULT_MODEL_ID, readPreferences, readPromptHistory, resolveExplicitServerUrl, resolveServerUrl, writePreferences } from "./config.js";
import { formatCliError } from "./errors.js";
import { App } from "./repl/App.js";
import { BootScreen } from "./repl/BootScreen.js";
import { createTuiTheme } from "./repl/theme.js";
import { mountFullscreen } from "./repl/tui-lifecycle.js";
import type { CliMode, CliStreamPort, CommandDeps } from "./types.js";

interface GlobalOptions {
  server?: string;
  origin?: string;
}

/**
 * Resolves the backend (embedded in-process by default, or an external server
 * when `--server`/`HARNESS_SERVER_URL` is set), runs a one-shot command, and
 * always tears the backend — and any embedded server — down afterwards.
 */
async function withBackend(
  options: GlobalOptions,
  opts: { stream?: boolean },
  fn: (deps: CommandDeps) => Promise<unknown>,
): Promise<void> {
  const backend = await resolveCliBackend(options);
  const deps: CommandDeps = {
    http: backend.http,
    write: (line) => output.write(`${line}\n`),
    writeRaw: (text) => output.write(text),
    writeError: (line) => stderr.write(`${line}\n`),
  };
  if (opts.stream) {
    const token = await backend.http.ensureCsrfToken();
    deps.stream = backend.createStream(token);
  }
  try {
    await fn(deps);
  } finally {
    deps.stream?.close?.();
    await backend.dispose();
  }
}

async function runChat(options: GlobalOptions & { agent?: string; mode?: CliMode; model?: string; workspace?: string }): Promise<void> {
  if (input.isTTY !== true || output.isTTY !== true) {
    throw new Error("Interactive chat requires a TTY. Pipe prompts to `harness run` or run `harness` with no args on a terminal.");
  }
  const theme = createTuiTheme();
  const workspace = options.workspace ?? process.cwd();

  let backend: CliBackend | null = null;
  let stream: CliStreamPort | null = null;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      stream?.close?.();
    } catch {
      // best-effort socket teardown
    }
    void backend?.dispose();
  };

  // Paint the shell immediately; the (embedded) server boots in the background so
  // the user sees instant feedback instead of a frozen terminal during startup.
  const session = mountFullscreen(React.createElement(BootScreen, { workspace, theme }), { onExit: cleanup });
  try {
    let exited = false;
    void session.waitUntilExit().then(() => {
      exited = true;
    });

    backend = await resolveCliBackend(options);
    const http = backend.http;
    await http.ensureCsrfToken();
    const prefs = await readPreferences();
    const agentInput: { agentId?: string; model?: string; mode?: CliMode; workspace: string } = { workspace };
    const model = options.model ?? prefs.preferredModel;
    const mode = options.mode ?? prefs.preferredMode;
    if (options.agent !== undefined) agentInput.agentId = options.agent;
    if (model !== undefined) agentInput.model = model;
    if (mode !== undefined) agentInput.mode = mode;
    const agent = await http.getOrCreateAgent(agentInput);
    const token = await http.ensureCsrfToken();
    stream = backend.createStream(token);
    const historyEntries = await readPromptHistory();
    await writePreferences({
      preferredMode: options.mode ?? prefs.preferredMode ?? agent.executionMode,
      preferredModel: options.model ?? prefs.preferredModel ?? agent.modelId,
    });

    if (exited) return;

    session.rerender(React.createElement(App, {
      agent,
      mode: options.mode ?? prefs.preferredMode ?? agent.executionMode ?? "agent",
      modelId: options.model ?? prefs.preferredModel ?? agent.modelId ?? DEFAULT_MODEL_ID,
      workspace,
      historyEntries,
      http,
      stream,
    }));
    await session.waitUntilExit();
  } finally {
    session.dispose();
    cleanup();
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8").trim();
}

const program = new Command();
program
  .name("harness")
  .description("Terminal-native Cursor SDK Agent Harness client")
  .option("--server <url>", "Attach to an external Harness server instead of the embedded one")
  .option("--origin <url>", "Origin header for WebSocket upgrades (advanced)");

program
  .command("chat")
  .option("--agent <id>", "Start with a specific agent")
  .option("--mode <mode>", "Initial mode: ask | agent", "agent")
  .option("--model <id>", "Model override")
  .option("--workspace <path>", "Workspace directory", process.cwd())
  .action(async (options) => runCommand(async () => runChat({ ...program.opts<GlobalOptions>(), ...options, mode: normalizeMode(options.mode) })));

program
  .command("run")
  .argument("[prompt...]", "Prompt text")
  .option("--agent <id>", "Use a specific agent")
  .option("--mode <mode>", "ask | agent", "agent")
  .option("--model <id>", "Model to use")
  .option("--workspace <path>", "Workspace directory", process.cwd())
  .option("--json", "Output JSONL")
  .option("--no-stream", "Wait for complete response")
  .option("--timeout <ms>", "Max wait time", "300000")
  .option("--approve", "Auto-approve approval prompts")
  .action(async (promptParts: string[], options) => runCommand(async () => {
    const prompt = promptParts.length > 0 ? promptParts.join(" ") : await readStdin();
    await withBackend(program.opts<GlobalOptions>(), { stream: true }, async (deps) => {
      process.exitCode = await runPrompt({
        prompt,
        agent: options.agent,
        mode: normalizeMode(options.mode),
        model: options.model,
        workspace: options.workspace,
        json: Boolean(options.json),
        noStream: options.stream === false,
        timeout: Number(options.timeout),
        approve: Boolean(options.approve),
      }, deps);
    });
  }));

const agents = program.command("agents");
agents.command("list").option("--json", "Output JSONL").action(async (options) => {
  await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => listAgents({ json: Boolean(options.json) }, deps)));
});
agents.command("create").argument("<name>").option("--model <id>", "Model", DEFAULT_MODEL_ID).option("--mode <mode>", "Default execution mode", "agent").option("--workspace <path>", "Workspace", process.cwd()).option("--json", "Output JSONL").action(async (name: string, options) => {
  await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => createAgent({ name, model: options.model, mode: normalizeMode(options.mode), workspace: options.workspace, json: Boolean(options.json) }, deps)));
});

program.command("search").argument("<query>").option("--workspace <path>", "Workspace to search").option("--max-results <n>", "Limit", "20").option("--files-only", "File search instead of grep").option("--json", "Output JSONL").action(async (query: string, options) => {
  await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => searchWorkspace({ query, workspace: options.workspace, maxResults: Number(options.maxResults), filesOnly: Boolean(options.filesOnly), json: Boolean(options.json) }, deps)));
});

program.command("history").option("--agent <id>", "Filter by agent").option("--limit <n>", "Number of results", "20").option("--json", "Output JSONL").action(async (options) => {
  await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => showHistory({ agent: options.agent, limit: Number(options.limit), json: Boolean(options.json) }, deps)));
});

if (process.argv.length <= 2) {
  if (input.isTTY !== true) {
    const prompt = await readStdin();
    await runCommand(async () => withBackend(program.opts<GlobalOptions>(), { stream: true }, async (deps) => {
      process.exitCode = await runPrompt({ prompt, mode: "agent" }, deps);
    }));
  } else {
    await runCommand(async () => runChat(program.opts<GlobalOptions>()));
  }
} else {
  await program.parseAsync(process.argv);
}

function normalizeMode(value: unknown): CliMode {
  return value === "ask" ? "ask" : "agent";
}

async function runCommand(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const serverFlag = program.opts<GlobalOptions>().server;
    const embedded = resolveExplicitServerUrl(serverFlag) === undefined;
    const { message, exitCode } = formatCliError(error, resolveServerUrl(serverFlag), embedded);
    stderr.write(`${message}\n`);
    process.exitCode = exitCode;
  }
}
