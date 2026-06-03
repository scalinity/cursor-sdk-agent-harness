import { CLI_NAME } from "@harness/shared";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { CliHttpError } from "../src/client/http.js";
import {
  assertRunPromptInput,
  attachDefaultChatAction,
  normalizeChatCommandOptions,
  shouldCreateFreshAgentForSavedSession,
  type GlobalOptions,
} from "../src/index.js";

function createRootProgram(onDefault: (options: GlobalOptions) => Promise<void> | void) {
  let output = "";
  const program = new Command();
  program
    .name(CLI_NAME)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => {
        output += value;
      },
      writeErr: (value) => {
        output += value;
      },
    })
    .option("-r, --resume", "Resume the most recently closed chat session")
    .option("--server <url>", "Attach to an external Orrery server instead of the embedded one")
    .option("--origin <url>", "Origin header for WebSocket upgrades (advanced)");
  attachDefaultChatAction(program, async (options) => {
    await onDefault(options);
  });
  return { program, output: () => output };
}

describe("CLI root command parsing", () => {
  it("launches the default chat action for orrery -r", async () => {
    const calls: GlobalOptions[] = [];
    const { program, output } = createRootProgram((options) => {
      calls.push(options);
    });
    program.command("chat").action(() => {
      throw new Error("chat subcommand should not run");
    });

    await program.parseAsync(["node", CLI_NAME, "-r"]);

    expect(output()).toBe("");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ resume: true });
  });

  it("keeps global options available when defaulting to chat", async () => {
    const calls: GlobalOptions[] = [];
    const { program } = createRootProgram((options) => {
      calls.push(options);
    });
    program.command("chat").action(() => {
      throw new Error("chat subcommand should not run");
    });

    await program.parseAsync([
      "node",
      CLI_NAME,
      "--server",
      "http://127.0.0.1:4783",
      "--origin",
      "http://127.0.0.1:5173",
      "-r",
    ]);

    expect(calls).toEqual([
      {
        server: "http://127.0.0.1:4783",
        origin: "http://127.0.0.1:5173",
        resume: true,
      },
    ]);
  });

  it("does not run the default action for explicit subcommands", async () => {
    const calls: GlobalOptions[] = [];
    let chatCalls = 0;
    const { program } = createRootProgram((options) => {
      calls.push(options);
    });
    program.command("chat").action(() => {
      chatCalls += 1;
    });

    await program.parseAsync(["node", CLI_NAME, "chat"]);

    expect(calls).toEqual([]);
    expect(chatCalls).toBe(1);
  });

  it("normalizes chat options without injecting defaults over resumed sessions", () => {
    expect(normalizeChatCommandOptions({ resume: true }, {})).toEqual({ resume: true });
    expect(normalizeChatCommandOptions(
      { server: "http://127.0.0.1:4783", resume: true },
      { mode: "ask", model: "composer-2-5", workspace: "/work/project", agent: "agent-1" },
    )).toEqual({
      server: "http://127.0.0.1:4783",
      resume: true,
      mode: "ask",
      model: "composer-2-5",
      workspace: "/work/project",
      agent: "agent-1",
    });
  });

  it("only falls back from a saved agent when the server reports it missing", () => {
    expect(shouldCreateFreshAgentForSavedSession(
      new CliHttpError("missing", 404, "AGENT_NOT_FOUND", null),
    )).toBe(true);
    expect(shouldCreateFreshAgentForSavedSession(
      new CliHttpError("network", 0, "NETWORK_ERROR", null),
    )).toBe(false);
    expect(shouldCreateFreshAgentForSavedSession(new Error("boom"))).toBe(false);
  });

  it("rejects orrery run with no prompt when stdin is a TTY", () => {
    expect(() => assertRunPromptInput([], true)).toThrow(new RegExp(`${CLI_NAME} run <prompt>`, "i"));
    expect(() => assertRunPromptInput([], false)).not.toThrow();
    expect(() => assertRunPromptInput(["hello"], true)).not.toThrow();
  });
});
