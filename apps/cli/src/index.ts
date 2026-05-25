#!/usr/bin/env node
import { stdin as input, stdout as output, stderr } from "node:process";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { createAgent, listAgents } from "./commands/agents.js";
import { showHistory } from "./commands/history.js";
import { runPrompt } from "./commands/run.js";
import { searchWorkspace } from "./commands/search.js";
import { HarnessHttpClient } from "./client/http.js";
import { HarnessWsClient } from "./client/ws.js";
import { DEFAULT_MODEL_ID, readPromptHistory, resolveServerUrl } from "./config.js";
import { App } from "./repl/App.js";
import type { CliMode, CommandDeps } from "./types.js";

interface GlobalOptions {
  server?: string;
}

function createHttp(options: GlobalOptions): HarnessHttpClient {
  return new HarnessHttpClient({ serverUrl: resolveServerUrl(options.server) });
}

async function createDeps(options: GlobalOptions, stream = false): Promise<CommandDeps> {
  const http = createHttp(options);
  const deps: CommandDeps = {
    http,
    write: (line) => output.write(`${line}\n`),
    writeError: (line) => stderr.write(`${line}\n`),
  };
  if (stream) {
    const token = await http.ensureCsrfToken();
    deps.stream = new HarnessWsClient({ serverUrl: http.serverUrl, csrfToken: token });
  }
  return deps;
}

async function runChat(options: GlobalOptions & { agent?: string; mode?: CliMode; model?: string; workspace?: string }): Promise<void> {
  const http = createHttp(options);
  await http.ensureCsrfToken();
  const agentInput: { agentId?: string; model?: string; mode?: CliMode; workspace?: string } = {};
  if (options.agent !== undefined) agentInput.agentId = options.agent;
  if (options.model !== undefined) agentInput.model = options.model;
  if (options.mode !== undefined) agentInput.mode = options.mode;
  if (options.workspace !== undefined) agentInput.workspace = options.workspace;
  const agent = await http.getOrCreateAgent(agentInput);
  const token = await http.ensureCsrfToken();
  const stream = new HarnessWsClient({ serverUrl: http.serverUrl, csrfToken: token });
  const historyEntries = await readPromptHistory();
  render(React.createElement(App, {
    agent,
    mode: options.mode ?? agent.executionMode ?? "agent",
    modelId: options.model ?? agent.modelId ?? DEFAULT_MODEL_ID,
    workspace: options.workspace ?? process.cwd(),
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
  .option("--server <url>", "Harness server URL", resolveServerUrl());

program
  .command("chat")
  .option("--agent <id>", "Start with a specific agent")
  .option("--mode <mode>", "Initial mode: ask | agent", "agent")
  .option("--model <id>", "Model override")
  .option("--workspace <path>", "Workspace directory", process.cwd())
  .action(async (options) => runChat({ ...program.opts<GlobalOptions>(), ...options, mode: normalizeMode(options.mode) }));

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
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.length > 0 ? promptParts.join(" ") : await readStdin();
    const deps = await createDeps(program.opts<GlobalOptions>(), options.stream !== false);
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

const agents = program.command("agents");
agents.command("list").option("--json", "Output JSONL").action(async (options) => {
  await listAgents({ json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>()));
});
agents.command("create").argument("<name>").option("--model <id>", "Model", DEFAULT_MODEL_ID).option("--mode <mode>", "Default execution mode", "agent").option("--workspace <path>", "Workspace", process.cwd()).option("--json", "Output JSONL").action(async (name: string, options) => {
  await createAgent({ name, model: options.model, mode: normalizeMode(options.mode), workspace: options.workspace, json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>()));
});

program.command("search").argument("<query>").option("--workspace <path>", "Workspace to search").option("--max-results <n>", "Limit", "20").option("--files-only", "File search instead of grep").option("--json", "Output JSONL").action(async (query: string, options) => {
  await searchWorkspace({ query, workspace: options.workspace, maxResults: Number(options.maxResults), filesOnly: Boolean(options.filesOnly), json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>()));
});

program.command("history").option("--agent <id>", "Filter by agent").option("--limit <n>", "Number of results", "20").option("--json", "Output JSONL").action(async (options) => {
  await showHistory({ agent: options.agent, limit: Number(options.limit), json: Boolean(options.json) }, await createDeps(program.opts<GlobalOptions>()));
});

if (process.argv.length <= 2) {
  if (input.isTTY === false) {
    const prompt = await readStdin();
    const deps = await createDeps(program.opts<GlobalOptions>(), true);
    process.exitCode = await runPrompt({ prompt, mode: "agent" }, deps);
  } else {
    await runChat(program.opts<GlobalOptions>());
  }
} else {
  await program.parseAsync(process.argv);
}

function normalizeMode(value: unknown): CliMode {
  return value === "ask" ? "ask" : "agent";
}
