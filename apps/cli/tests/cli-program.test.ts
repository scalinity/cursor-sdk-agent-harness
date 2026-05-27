import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { attachDefaultChatAction, type GlobalOptions } from "../src/index.js";

function createRootProgram(onDefault: (options: GlobalOptions) => Promise<void> | void) {
  let output = "";
  const program = new Command();
  program
    .name("harness")
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
    .option("--server <url>", "Attach to an external Harness server instead of the embedded one")
    .option("--origin <url>", "Origin header for WebSocket upgrades (advanced)");
  attachDefaultChatAction(program, async (options) => {
    await onDefault(options);
  });
  return { program, output: () => output };
}

describe("CLI root command parsing", () => {
  it("launches the default chat action for harness -r", async () => {
    const calls: GlobalOptions[] = [];
    const { program, output } = createRootProgram((options) => {
      calls.push(options);
    });
    program.command("chat").action(() => {
      throw new Error("chat subcommand should not run");
    });

    await program.parseAsync(["node", "harness", "-r"]);

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
      "harness",
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

    await program.parseAsync(["node", "harness", "chat"]);

    expect(calls).toEqual([]);
    expect(chatCalls).toBe(1);
  });
});
