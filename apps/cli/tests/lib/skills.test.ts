import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSkillInvocationPrompt,
  buildSkillMarkdown,
  createSkill,
  isValidSkillName,
  listSkills,
  normalizeSkillLookupKey,
  resolveSkillBySlashCommand,
  skillFilePath,
} from "../../src/lib/skills.js";

describe("skills library", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeWorkspace(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-cli-skill-"));
    tempDirs.push(dir);
    return dir;
  }

  it("validates skill names", () => {
    expect(isValidSkillName("deploy-staging")).toBe(true);
    expect(isValidSkillName("DeployStaging")).toBe(false);
    expect(isValidSkillName("bad name")).toBe(false);
  });

  it("builds Cursor-compatible SKILL.md frontmatter", () => {
    const markdown = buildSkillMarkdown({
      name: "review-pr",
      description: "Review pull requests for regressions.",
      paths: ["**/*.ts"],
      manual: true,
    });

    expect(markdown).toContain("name: review-pr");
    expect(markdown).toContain('description: "Review pull requests for regressions."');
    expect(markdown).toContain("paths:");
    expect(markdown).toContain('  - "**/*.ts"');
    expect(markdown).toContain("disable-model-invocation: true");
    expect(markdown).toContain("# Review Pr");
  });

  it("creates and lists project skills", async () => {
    const workspace = await makeWorkspace();
    const created = await createSkill({
      name: "write-tests",
      description: "Generate focused unit tests for changed code.",
      workspace,
    });

    expect(created.scope).toBe("project");
    const filePath = skillFilePath(path.join(workspace, ".cursor/skills"), "write-tests");
    expect(created.filePath).toBe(filePath);
    expect(await readFile(filePath, "utf8")).toContain("Generate focused unit tests");

    const skills = await listSkills({ workspace });
    expect(skills.some((skill) => skill.name === "write-tests" && skill.scope === "project")).toBe(true);
  });

  it("refuses invalid skill names before creating a path", async () => {
    const workspace = await makeWorkspace();
    await expect(createSkill({
      name: "../escape",
      description: "Try to leave the skills root.",
      workspace,
    })).rejects.toThrow(/lowercase letters/i);
  });

  it("writes project skill files without group or world permissions", async () => {
    const workspace = await makeWorkspace();
    const created = await createSkill({
      name: "private-skill",
      description: "Keep skill instructions private to the user.",
      workspace,
    });

    const mode = (await stat(created.filePath)).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });

  it("refuses symlinked skill directories and files", async () => {
    const workspace = await makeWorkspace();
    const skillsRoot = path.join(workspace, ".cursor/skills");
    const outside = await mkdtemp(path.join(os.tmpdir(), "harness-cli-skill-outside-"));
    tempDirs.push(outside);
    await mkdir(skillsRoot, { recursive: true });
    await symlink(outside, path.join(skillsRoot, "linked-skill"));
    await expect(createSkill({
      name: "linked-skill",
      description: "Must not follow symlinked skill directories.",
      workspace,
      force: true,
    })).rejects.toThrow(/symlink/i);
  });

  it("refuses to overwrite unless forced", async () => {
    const workspace = await makeWorkspace();
    await createSkill({ name: "lint-fix", description: "Fix lint issues.", workspace });
    await expect(createSkill({ name: "lint-fix", description: "Fix lint issues.", workspace }))
      .rejects.toThrow(/already exists/i);
  });

  it("resolves slash aliases without hyphens", () => {
    expect(normalizeSkillLookupKey("skill-creator")).toBe("skillcreator");
    expect(normalizeSkillLookupKey("Skill-Creator")).toBe("skillcreator");
  });

  it("builds a skill invocation prompt with optional args", () => {
    const skill = {
      name: "skill-creator",
      description: "Guides skill creation.",
      filePath: "/tmp/.cursor/skills/skill-creator/SKILL.md",
      scope: "global" as const,
    };
    const prompt = buildSkillInvocationPrompt(skill, "# Skill Creator\n\nDo the thing.", ["help me"]);
    expect(prompt).toContain('Apply the "skill-creator" skill');
    expect(prompt).toContain("User request: help me");
    expect(buildSkillInvocationPrompt(skill, "Body", [])).toContain("User request: Begin.");
  });

  it("resolves installed skills by slash alias", async () => {
    const workspace = await makeWorkspace();
    await createSkill({
      name: "skill-creator",
      description: "Guides skill creation.",
      workspace,
    });
    expect(await resolveSkillBySlashCommand("skillcreator", workspace)).toMatchObject({ name: "skill-creator" });
    expect(await resolveSkillBySlashCommand("skill-creator", workspace)).toMatchObject({ name: "skill-creator" });
    expect(await resolveSkillBySlashCommand("missing", workspace)).toBeNull();
  });
});
