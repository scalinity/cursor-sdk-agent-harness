#!/usr/bin/env node
import { stdin as input, stdout as output, stderr } from "node:process";
import { Command } from "commander";
import React from "react";
import { createAgent, listAgents } from "./commands/agents.js";
import { showHistory } from "./commands/history.js";
import { runPrompt } from "./commands/run.js";
import { searchWorkspace } from "./commands/search.js";
import { HarnessHttpClient } from "./client/http.js";
import { HarnessWsClient } from "./client/ws.js";
import { DEFAULT_MODEL_ID, readPreferences, readPromptHistory, resolveServerUrl, resolveWebOrigin, writePreferences } from "./config.js";
import { formatCliError } from "./errors.js";
import { App } from "./repl/App.js";
import { renderFullscreenApp } from "./repl/tui-lifecycle.js";
import type { CliMode, CommandDeps } from "./types.js";

interface GlobalOptions {
  server?: string;
  origin?: string;
}

function createHttp(options: GlobalOptions): HarnessHttpClient {
  return new HarnessHttpClient({ serverUrl: resolveServerUrl(options.server), origin: resolveWebOrigin(options.origin) });
}

async function createDeps(options: GlobalOptions, stream = false): Promise<CommandDeps> {
  const http = createHttp(options);
  const deps: CommandDeps = {
    http,
    write: (line) => output.write(`${line}\n`),
    writeRaw: (text) => output.write(text),
    writeError: (line) => stderr.write(`${line}\n`),
  };
  if (stream) {
    const token = await http.ensureCsrfToken();
    deps.stream = new HarnessWsClient({ serverUrl: http.serverUrl, csrfToken: token, origin: resolveWebOrigin(options.origin) });
  }
  return deps;
}

async function runChat(options: GlobalOptions & { agent?: string; mode?: CliMode; model?: string; workspace?: string }): Promise<void> {
  const http = createHttp(options);
  await http.ensureCsrfToken();
  const prefs = await readPreferences();
  const workspace = options.workspace ?? process.cwd();
  const agentInput: { agentId?: string; model?: string; mode?: CliMode; workspace: string } = { workspace };
  const model = options.model ?? prefs.preferredModel;
  const mode = options.mode ?? prefs.preferredMode;
  if (options.agent !== undefined) agentInput.agentId = options.agent;
  if (model !== undefined) agentInput.model = model;
  if (mode !== undefined) agentInput.mode = mode;
  const agent = await http.getOrCreateAgent(agentInput);
  const token = await http.ensureCsrfToken();
  const stream = new HarnessWsClient({ serverUrl: http.serverUrl, csrfToken: token, origin: resolveWebOrigin(options.origin) });
  const historyEntries = await readPromptHistory();
  await writePreferences({
    preferredMode: options.mode ?? prefs.preferredMode ?? agent.executionMode,
    preferredModel: options.model ?? prefs.preferredModel ?? agent.modelId,
  });
  await renderFullscreenApp(React.createElement(App, {
    agent,
    mode: options.mode ?? prefs.preferredMode ?? agent.executionMode ?? "agent",
    modelId: options.model ?? prefs.preferredModel ?? agent.modelId ?? DEFAULT_MODEL_ID,
    workspace,
    historyEntries,
    http,
    stream,
  }));
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
  .option("--server <url>", "Harness server URL", resolveServerUrl())
  .option("--origin <url>", "Origin header for WebSocket upgrades", resolveWebOrigin());

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
    const deps = await createDeps(program.opts<GlobalOptions>(), true);
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
  }));

const agents = program.command("agents");
agents.command("list").option("--json", "Output JSONL").action(async (options) => {
  await runCommand(async () => listAgents({ json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>())));
});
agents.command("create").argument("<name>").option("--model <id>", "Model", DEFAULT_MODEL_ID).option("--mode <mode>", "Default execution mode", "agent").option("--workspace <path>", "Workspace", process.cwd()).option("--json", "Output JSONL").action(async (name: string, options) => {
  await runCommand(async () => createAgent({ name, model: options.model, mode: normalizeMode(options.mode), workspace: options.workspace, json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>())));
});

program.command("search").argument("<query>").option("--workspace <path>", "Workspace to search").option("--max-results <n>", "Limit", "20").option("--files-only", "File search instead of grep").option("--json", "Output JSONL").action(async (query: string, options) => {
  await runCommand(async () => searchWorkspace({ query, workspace: options.workspace, maxResults: Number(options.maxResults), filesOnly: Boolean(options.filesOnly), json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>())));
});

program.command("history").option("--agent <id>", "Filter by agent").option("--limit <n>", "Number of results", "20").option("--json", "Output JSONL").action(async (options) => {
  await runCommand(async () => showHistory({ agent: options.agent, limit: Number(options.limit), json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>())));
});

if (process.argv.length <= 2) {
  if (input.isTTY === false) {
    const prompt = await readStdin();
    await runCommand(async () => {
      const deps = await createDeps(program.opts<GlobalOptions>(), true);
      process.exitCode = await runPrompt({ prompt, mode: "agent" }, deps);
    });
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
    const { message, exitCode } = formatCliError(error, resolveServerUrl(program.opts<GlobalOptions>().server));
    stderr.write(`${message}\n`);
    process.exitCode = exitCode;
  }
}
