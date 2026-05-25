import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readRulesFromWorkspace,
  resolveRulesForRun,
  assembleRulesBlock,
} from "../rules.service.js";

describe("readRulesFromWorkspace", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rules-test-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when .harness/rules doesn't exist", async () => {
    const rules = await readRulesFromWorkspace(tmpDir);
    expect(rules).toEqual([]);
  });

  it("reads and parses rule files with valid frontmatter", async () => {
    await fs.mkdir(path.join(tmpDir, ".harness", "rules"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".harness", "rules", "test.md"),
      `---
name: my-rule
scope: always
description: A test rule
---

Rule content here.
`,
    );

    const rules = await readRulesFromWorkspace(tmpDir);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.name).toBe("my-rule");
    expect(rules[0]!.scope).toBe("always");
    expect(rules[0]!.description).toBe("A test rule");
    expect(rules[0]!.content).toBe("Rule content here.");
  });

  it("skips files with invalid frontmatter", async () => {
    await fs.mkdir(path.join(tmpDir, ".harness", "rules"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".harness", "rules", "bad.md"),
      "No frontmatter at all, just text.",
    );
    await fs.writeFile(
      path.join(tmpDir, ".harness", "rules", "good.md"),
      `---
name: good-rule
scope: always
description: Good rule
---

Content.
`,
    );

    const rules = await readRulesFromWorkspace(tmpDir);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.name).toBe("good-rule");
  });

  it("skips glob-scoped rules missing a glob pattern", async () => {
    await fs.mkdir(path.join(tmpDir, ".harness", "rules"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".harness", "rules", "no-glob.md"),
      `---
name: missing-glob
scope: glob
description: Missing glob pattern
---

Content.
`,
    );

    const rules = await readRulesFromWorkspace(tmpDir);
    expect(rules).toHaveLength(0);
  });

  it("sorts rules: always first, then glob, then manual", async () => {
    await fs.mkdir(path.join(tmpDir, ".harness", "rules"), { recursive: true });
    const files = [
      { name: "z-manual.md", scope: "manual", glob: "" },
      { name: "a-always.md", scope: "always", glob: "" },
      { name: "m-glob.md", scope: "glob", glob: '"*.ts"' },
    ];
    for (const f of files) {
      const globLine = f.glob ? `\nglob: ${f.glob}` : "";
      await fs.writeFile(
        path.join(tmpDir, ".harness", "rules", f.name),
        `---\nname: ${f.name.replace(".md", "")}\nscope: ${f.scope}${globLine}\ndescription: test\n---\ncontent`,
      );
    }
    const rules = await readRulesFromWorkspace(tmpDir);
    expect(rules.map((r) => r.scope)).toEqual(["always", "glob", "manual"]);
  });
});

describe("resolveRulesForRun", () => {
  const alwaysRule = {
    name: "always-rule", scope: "always" as const,
    description: "always", content: "always content", filePath: "always.md",
  };
  const globRule = {
    name: "glob-rule", scope: "glob" as const, glob: "src/routes/**/*.ts",
    description: "glob", content: "glob content", filePath: "glob.md",
  };
  const manualRule = {
    name: "manual-rule", scope: "manual" as const,
    description: "manual", content: "manual content", filePath: "manual.md",
  };

  it("always includes 'always' scope rules", () => {
    const result = resolveRulesForRun([alwaysRule, globRule, manualRule], [], []);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("always-rule");
  });

  it("includes glob rules when mentioned paths match", () => {
    const result = resolveRulesForRun(
      [alwaysRule, globRule],
      ["src/routes/api/users.ts"],
      [],
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toContain("glob-rule");
  });

  it("does not include glob rules when no paths match", () => {
    const result = resolveRulesForRun(
      [alwaysRule, globRule],
      ["src/lib/utils.ts"],
      [],
    );
    expect(result).toHaveLength(1);
  });

  it("includes manual rules when explicitly mentioned", () => {
    const result = resolveRulesForRun(
      [alwaysRule, manualRule],
      [],
      ["manual-rule"],
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toContain("manual-rule");
  });

  it("does not include manual rules when not mentioned", () => {
    const result = resolveRulesForRun([manualRule], [], []);
    expect(result).toHaveLength(0);
  });
});

describe("assembleRulesBlock", () => {
  it("returns empty string for no rules", () => {
    expect(assembleRulesBlock([])).toBe("");
  });

  it("wraps rules in project-rules tags", () => {
    const block = assembleRulesBlock([
      {
        name: "test", scope: "always", description: "desc",
        content: "rule body", filePath: "test.md",
      },
    ]);
    expect(block).toContain("<project-rules>");
    expect(block).toContain("## test: desc");
    expect(block).toContain("rule body");
    expect(block).toContain("</project-rules>");
  });
});
