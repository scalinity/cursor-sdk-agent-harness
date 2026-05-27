#!/usr/bin/env node
import { stdin as input, stdout as output, stderr } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import React from "react";
import { createAgent, listAgents } from "./commands/agents.js";
import { showHistory } from "./commands/history.js";
import { runPrompt } from "./commands/run.js";
import { createSkillCommand, listSkillsCommand, parseSkillPaths } from "./commands/skills.js";
import { searchWorkspace } from "./commands/search.js";
import { resolveCliBackend, type CliBackend } from "./backend.js";
import { DEFAULT_MODEL_ID, readPreferences, readPromptHistory, resolveExplicitServerUrl, resolveServerUrl, writePreferences } from "./config.js";
import { CliUsageError, formatCliError } from "./errors.js";
import { App } from "./repl/App.js";
import { BootScreen } from "./repl/BootScreen.js";
import { createTuiTheme } from "./repl/theme.js";
import { readLastSession, writeLastSession, type CliSessionSnapshot } from "./session.js";
import { mountFullscreen } from "./repl/tui-lifecycle.js";
import type { CliAgentSummary, CliHttpPort, CliMode, CliStreamPort, CommandDeps } from "./types.js";

export interface GlobalOptions {
  server?: string;
  origin?: string;
  resume?: boolean;
}

export function attachDefaultChatAction(
  command: Command,
  action: (options: GlobalOptions) => Promise<void>,
): void {
  command.action(async (options: GlobalOptions) => action({
    ...options,
    resume: Boolean(options.resume),
  }));
}

async function resolveAgentForChat(
  http: CliHttpPort,
  input: {
    agentId?: string;
    model?: string;
    mode?: CliMode;
    workspace: string;
    savedSession?: CliSessionSnapshot | null;
  },
): Promise<CliAgentSummary> {
  if (input.agentId) {
    const detail = await http.getAgent(input.agentId);
    return agentSummaryFromDetail(detail);
  }
  if (input.savedSession) {
    try {
      const detail = await http.getAgent(input.savedSession.agent.id);
      return agentSummaryFromDetail(detail);
    } catch {
      // Fall back to a fresh agent in the saved workspace if the backing agent is gone.
    }
  }
  const agentInput: { model?: string; mode?: CliMode; workspace: string } = { workspace: input.workspace };
  if (input.model !== undefined) agentInput.model = input.model;
  else if (input.savedSession) agentInput.model = input.savedSession.modelId;
  if (input.mode !== undefined) agentInput.mode = input.mode;
  else if (input.savedSession) agentInput.mode = input.savedSession.mode;
  return http.getOrCreateAgent(agentInput);
}

function agentSummaryFromDetail(agent: { id: string; name: string; modelId: string; executionMode: string }): CliAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    modelId: agent.modelId,
    executionMode: agent.executionMode === "ask" ? "ask" : "agent",
  };
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
  const savedSession = options.resume ? await readLastSession() : null;
  if (options.resume && !savedSession) {
    throw new CliUsageError("No saved chat session found. Start a chat with `harness` first.");
  }

  const theme = createTuiTheme();
  const workspace = options.workspace ?? savedSession?.workspace ?? process.cwd();

  let backend: CliBackend | null = null;
  let stream: CliStreamPort | null = null;
  let cleanedUp = false;
  let getSnapshot: (() => CliSessionSnapshot) | null = null;
  const persistSession = async () => {
    const snapshot = getSnapshot?.();
    if (!snapshot) return;
    try {
      await writeLastSession(snapshot);
    } catch (error: unknown) {
      stderr.write(`Session was not saved: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  };
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
  const session = mountFullscreen(React.createElement(BootScreen, { workspace, theme }), {
    onExit: () => {
      void persistSession();
      cleanup();
    },
  });
  try {
    let exited = false;
    void session.waitUntilExit().then(() => {
      exited = true;
    });

    backend = await resolveCliBackend(options);
    const http = backend.http;
    await http.ensureCsrfToken();
    const prefs = await readPreferences();
    const model = options.model ?? savedSession?.modelId ?? prefs.preferredModel;
    const mode = options.mode ?? savedSession?.mode ?? prefs.preferredMode;
    const agent = await resolveAgentForChat(http, {
      ...(options.agent !== undefined ? { agentId: options.agent } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(mode !== undefined ? { mode } : {}),
      workspace,
      savedSession,
    });
    const token = await http.ensureCsrfToken();
    stream = backend.createStream(token);
    const historyEntries = await readPromptHistory();
    const chatMode = options.mode ?? savedSession?.mode ?? prefs.preferredMode ?? agent.executionMode ?? "agent";
    const chatModelId = options.model ?? savedSession?.modelId ?? prefs.preferredModel ?? agent.modelId ?? DEFAULT_MODEL_ID;
    await writePreferences({
      lastAgentId: agent.id,
      preferredMode: chatMode,
      preferredModel: chatModelId,
    });

    if (exited) return;

    session.rerender(React.createElement(App, {
      agent,
      mode: chatMode,
      modelId: chatModelId,
      workspace,
      historyEntries,
      http,
      stream,
      ...(savedSession ? {
        resume: {
          buffer: savedSession.buffer,
          sessionCost: savedSession.sessionCost,
          scrollOffset: savedSession.scrollOffset,
        },
      } : {}),
      onRegisterSessionSnapshot: (getter) => {
        getSnapshot = getter;
      },
    }));
    await session.waitUntilExit();
  } finally {
    await persistSession();
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
  .option("-r, --resume", "Resume the most recently closed chat session")
  .option("--server <url>", "Attach to an external Harness server instead of the embedded one")
  .option("--origin <url>", "Origin header for WebSocket upgrades (advanced)");

attachDefaultChatAction(program, async (options) => runCommand(async () => {
  if (input.isTTY !== true) {
    if (options.resume) {
      throw new CliUsageError("Interactive resume requires a TTY. Run `harness -r` in a terminal.");
    }
    const prompt = await readStdin();
    await withBackend(options, { stream: true }, async (deps) => {
      process.exitCode = await runPrompt({ prompt, mode: "agent" }, deps);
    });
    return;
  }
  await runChat(options);
}));

program
  .command("chat")
  .option("--agent <id>", "Start with a specific agent")
  .option("--mode <mode>", "Initial mode: ask | agent", "agent")
  .option("--model <id>", "Model override")
  .option("--workspace <path>", "Workspace directory", process.cwd())
  .action(async (options) => runCommand(async () => runChat({
    ...program.opts<GlobalOptions>(),
    ...options,
    mode: normalizeMode(options.mode),
    resume: Boolean(program.opts<GlobalOptions>().resume),
  })));

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

const skills = program.command("skills").description("Create and manage Cursor agent skills on disk");
skills.command("list")
  .option("--workspace <path>", "Project workspace to scan", process.cwd())
  .option("--global", "List only global skills from ~/.cursor/skills")
  .option("--json", "Output JSONL")
  .action(async (options) => {
    await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => listSkillsCommand({
      workspace: options.workspace,
      global: Boolean(options.global),
      json: Boolean(options.json),
    }, deps)));
  });
skills.command("create")
  .argument("<name>", "Skill folder name (lowercase letters, numbers, hyphens)")
  .requiredOption("--description <text>", "When the agent should use this skill")
  .option("--content <markdown>", "Skill body markdown (defaults to a starter template)")
  .option("--file <path>", "Read skill body markdown from a file")
  .option("--paths <globs>", "Comma-separated file globs that scope the skill")
  .option("--manual", "Only invoke when explicitly requested (/skill-name)")
  .option("--global", "Write to ~/.cursor/skills instead of the project")
  .option("--workspace <path>", "Project workspace for project-scoped skills", process.cwd())
  .option("--force", "Overwrite an existing skill")
  .option("--json", "Output JSONL")
  .action(async (name: string, options) => {
    const paths = parseSkillPaths(options.paths);
    await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => createSkillCommand({
      name,
      description: options.description,
      ...(options.content !== undefined ? { content: options.content } : {}),
      ...(options.file !== undefined ? { file: options.file } : {}),
      ...(paths !== undefined ? { paths } : {}),
      ...(options.manual ? { manual: true } : {}),
      ...(options.global ? { global: true } : {}),
      workspace: options.workspace,
      ...(options.force ? { force: true } : {}),
      ...(options.json ? { json: true } : {}),
    }, deps)));
  });

program.command("search").argument("<query>").option("--workspace <path>", "Workspace to search").option("--max-results <n>", "Limit", "20").option("--files-only", "File search instead of grep").option("--json", "Output JSONL").action(async (query: string, options) => {
  await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => searchWorkspace({ query, workspace: options.workspace, maxResults: Number(options.maxResults), filesOnly: Boolean(options.filesOnly), json: Boolean(options.json) }, deps)));
});

program.command("history").option("--agent <id>", "Filter by agent").option("--limit <n>", "Number of results", "20").option("--json", "Output JSONL").action(async (options) => {
  await runCommand(async () => withBackend(program.opts<GlobalOptions>(), {}, (deps) => showHistory({ agent: options.agent, limit: Number(options.limit), json: Boolean(options.json) }, deps)));
});

if (isEntrypoint()) {
  await program.parseAsync(process.argv);
}

function isEntrypoint(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && path.resolve(entryPath) === fileURLToPath(import.meta.url);
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
