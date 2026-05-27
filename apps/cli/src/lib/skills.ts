import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliUsageError } from "../errors.js";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILLS_DIR = ".cursor/skills";

export interface SkillSummary {
  name: string;
  description: string;
  filePath: string;
  scope: "project" | "global";
}

export interface CreateSkillOptions {
  name: string;
  description: string;
  content?: string;
  paths?: string[];
  manual?: boolean;
  global?: boolean;
  workspace?: string;
  force?: boolean;
}

export interface CreatedSkill extends SkillSummary {
  created: true;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name);
}

export function resolveSkillsRoot(input: { workspace?: string; global?: boolean }): string {
  if (input.global) return path.join(os.homedir(), SKILLS_DIR);
  return path.join(path.resolve(input.workspace ?? process.cwd()), SKILLS_DIR);
}

export function skillDirectory(skillsRoot: string, name: string): string {
  return path.join(skillsRoot, name);
}

export function skillFilePath(skillsRoot: string, name: string): string {
  return path.join(skillDirectory(skillsRoot, name), "SKILL.md");
}

export function formatSkillTitle(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function yamlQuote(value: string): string {
  if (/[:#\n\r"'\\]/.test(value) || value.startsWith(" ") || value.endsWith(" ")) {
    return JSON.stringify(value);
  }
  return value;
}

function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const frontmatter: SkillFrontmatter = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key === "name") frontmatter.name = value;
    else if (key === "description") frontmatter.description = value;
  }

  return { frontmatter, body: match[2] ?? "" };
}

export function buildSkillMarkdown(options: CreateSkillOptions): string {
  if (!isValidSkillName(options.name)) {
    throw new CliUsageError("Skill name must use lowercase letters, numbers, and hyphens only.");
  }
  if (options.description.trim().length === 0) {
    throw new CliUsageError("Skill description is required.");
  }

  const lines = [
    "---",
    `name: ${options.name}`,
    `description: ${yamlQuote(options.description.trim())}`,
  ];

  if (options.paths && options.paths.length > 0) {
    lines.push("paths:");
    for (const pattern of options.paths) {
      lines.push(`  - ${yamlQuote(pattern)}`);
    }
  }

  if (options.manual) {
    lines.push("disable-model-invocation: true");
  }

  lines.push("---", "");

  const body = options.content?.trim();
  if (body && body.length > 0) {
    lines.push(body);
  } else {
    const title = formatSkillTitle(options.name);
    lines.push(
      `# ${title}`,
      "",
      "## When to use",
      "",
      options.description.trim(),
      "",
      "## Instructions",
      "",
      "1. Describe the first step the agent should take.",
      "2. Add any constraints, checks, or follow-up steps.",
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createSkill(options: CreateSkillOptions): Promise<CreatedSkill> {
  const skillsRoot = resolveSkillsRoot(options);
  const directory = skillDirectory(skillsRoot, options.name);
  const filePath = skillFilePath(skillsRoot, options.name);

  if (await pathExists(filePath) && !options.force) {
    throw new CliUsageError(`Skill already exists at ${filePath}. Pass --force to overwrite.`);
  }

  await mkdir(directory, { recursive: true });
  await writeFile(filePath, buildSkillMarkdown(options), "utf8");

  return {
    created: true,
    name: options.name,
    description: options.description.trim(),
    filePath,
    scope: options.global ? "global" : "project",
  };
}

async function readSkillAt(filePath: string, scope: SkillSummary["scope"]): Promise<SkillSummary | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const { frontmatter } = parseFrontmatter(raw);
  const name = frontmatter.name ?? path.basename(path.dirname(filePath));
  const description = frontmatter.description ?? "";
  if (!isValidSkillName(name) || description.length === 0) return null;

  return { name, description, filePath, scope };
}

async function listSkillsInRoot(skillsRoot: string, scope: SkillSummary["scope"]): Promise<SkillSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true }).then((items) =>
      items.filter((item) => item.isDirectory()).map((item) => item.name),
    );
  } catch {
    return [];
  }

  const skills: SkillSummary[] = [];
  for (const entry of entries.sort()) {
    const summary = await readSkillAt(skillFilePath(skillsRoot, entry), scope);
    if (summary) skills.push(summary);
  }
  return skills;
}

export async function listSkills(input: { workspace?: string; global?: boolean } = {}): Promise<SkillSummary[]> {
  if (input.global) {
    return listSkillsInRoot(resolveSkillsRoot({ global: true }), "global");
  }

  const project = await listSkillsInRoot(
    resolveSkillsRoot(input.workspace !== undefined ? { workspace: input.workspace, global: false } : { global: false }),
    "project",
  );
  const global = await listSkillsInRoot(resolveSkillsRoot({ global: true }), "global");
  const seen = new Set<string>();
  const merged: SkillSummary[] = [];
  for (const skill of [...project, ...global]) {
    const key = `${skill.scope}:${skill.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(skill);
  }
  return merged;
}

export function normalizeSkillLookupKey(name: string): string {
  return name.toLowerCase().replace(/-/g, "");
}

export async function resolveSkillBySlashCommand(command: string, workspace: string): Promise<SkillSummary | null> {
  const key = normalizeSkillLookupKey(command);
  if (key.length === 0) return null;

  const skills = await listSkills({ workspace });
  const matches = skills.filter((skill) => normalizeSkillLookupKey(skill.name) === key);
  if (matches.length === 0) return null;
  return matches.find((skill) => skill.scope === "project") ?? matches[0] ?? null;
}

export async function readSkillBody(filePath: string): Promise<string> {
  const raw = await readFile(filePath, "utf8");
  return parseFrontmatter(raw).body.trim();
}

export function buildSkillInvocationPrompt(skill: SkillSummary, body: string, args: readonly string[]): string {
  const userPart = args.length > 0 ? args.join(" ") : "Begin.";
  return [
    `Apply the "${skill.name}" skill (${skill.description}).`,
    "",
    body,
    "",
    `User request: ${userPart}`,
  ].join("\n");
}
