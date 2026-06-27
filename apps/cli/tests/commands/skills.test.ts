import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkillCommand, listSkillsCommand, parseSkillPaths } from "../../src/commands/skills.js";

describe("skills commands", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeWorkspace(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-skill-cmd-"));
    tempDirs.push(dir);
    return dir;
  }

  it("parses comma-separated path globs", () => {
    expect(parseSkillPaths("**/*.tsx, apps/cli/**")).toEqual(["**/*.tsx", "apps/cli/**"]);
    expect(parseSkillPaths(undefined)).toBeUndefined();
  });

  it("creates a skill and prints the path", async () => {
    const workspace = await makeWorkspace();
    const lines: string[] = [];

    await createSkillCommand({
      name: "summarize-diff",
      description: "Summarize code diffs for review.",
      workspace,
    }, { write: (line) => lines.push(line) });

    expect(lines.join("\n")).toContain("Created skill summarize-diff");
    expect(lines.join("\n")).toContain(".cursor/skills/summarize-diff/SKILL.md");
  });

  it("lists skills as a table", async () => {
    const workspace = await makeWorkspace();
    const skillDir = path.join(workspace, ".cursor/skills/demo-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), `---
name: demo-skill
description: Demo skill for tests.
---

# Demo
`);

    const lines: string[] = [];
    await listSkillsCommand({ workspace }, { write: (line) => lines.push(line) });

    expect(lines.join("\n")).toContain("demo-skill");
    expect(lines.join("\n")).toContain("Demo skill for tests.");
  });

  it("emits json when requested", async () => {
    const workspace = await makeWorkspace();
    const lines: string[] = [];

    await createSkillCommand({
      name: "json-skill",
      description: "JSON output test.",
      workspace,
      json: true,
    }, { write: (line) => lines.push(line) });

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      type: "skill_created",
      skill: { name: "json-skill", scope: "project" },
    });
  });

  it("warns on stderr when a skill name shadows a built-in command", async () => {
    const workspace = await makeWorkspace();
    const out: string[] = [];
    const err: string[] = [];

    await createSkillCommand({
      name: "history",
      description: "Collides with the built-in /history command.",
      workspace,
    }, { write: (line) => out.push(line), writeError: (line) => err.push(line) });

    expect(err.join("\n")).toContain("built-in");
    expect(err.join("\n")).toContain("history");
    // The success line still goes to stdout.
    expect(out.join("\n")).toContain("Created skill history");
  });

  it("does not warn for a non-colliding skill name", async () => {
    const workspace = await makeWorkspace();
    const err: string[] = [];

    await createSkillCommand({
      name: "summarize-diff",
      description: "No collision here.",
      workspace,
    }, { write: vi.fn(), writeError: (line) => err.push(line) });

    expect(err).toHaveLength(0);
  });

  it("requires a description", async () => {
    await expect(createSkillCommand({ name: "missing-description" }, { write: vi.fn() }))
      .rejects.toThrow(/description/i);
  });

  it("rejects both inline content and file content", async () => {
    const workspace = await makeWorkspace();
    const bodyPath = path.join(workspace, "skill-body.md");
    await writeFile(bodyPath, "# Body\n");

    await expect(createSkillCommand({
      name: "confused-source",
      description: "Reject ambiguous content sources.",
      content: "# Inline\n",
      file: bodyPath,
      workspace,
    }, { write: vi.fn() })).rejects.toThrow(/either --content or --file/i);
  });
});
