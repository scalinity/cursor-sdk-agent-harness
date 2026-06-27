import { constants } from "node:fs";
import { access, lstat, mkdir, open, readdir, readFile } from "node:fs/promises";
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
  return JSON.stringify(value);
}

function parseYamlScalar(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function assertValidSkillName(name: string): void {
  if (!isValidSkillName(name)) {
    throw new CliUsageError("Skill name must use lowercase letters, numbers, and hyphens only.");
  }
}

function assertPathInside(parent: string, child: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CliUsageError("Skill path must stay inside the skills directory.");
  }
}

function parseBlockScalar(indicator: string, lines: string[], startIndex: number): { value: string; nextIndex: number } {
  // We only distinguish folded (`>`) from literal (`|`). The chomping
  // indicators (`-`/`+`) only affect trailing newlines, which the final
  // trim() discards for these single-value frontmatter fields — so handling
  // them would be dead code.
  const folded = indicator.startsWith(">");
  const contentLines: string[] = [];
  let i = startIndex;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) {
      contentLines.push("");
      continue;
    }
    if (!line.startsWith(" ") && !line.startsWith("\t")) break;
    contentLines.push(line.replace(/^[ \t]+/, ""));
  }
  while (contentLines.length > 0 && contentLines[contentLines.length - 1] === "") {
    contentLines.pop();
  }
  let value: string;
  if (folded) {
    const foldedLines: string[] = [];
    let buffer = "";
    for (const line of contentLines) {
      if (line === "") {
        if (buffer.length > 0) {
          foldedLines.push(buffer);
          buffer = "";
        }
        foldedLines.push("");
      } else {
        buffer = buffer.length > 0 ? `${buffer} ${line}` : line;
      }
    }
    if (buffer.length > 0) foldedLines.push(buffer);
    value = foldedLines.join("\n");
  } else {
    value = contentLines.join("\n");
  }
  return { value: value.trim(), nextIndex: i };
}

function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = raw.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const frontmatter: SkillFrontmatter = {};
  const lines = match[1]!.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    let value: string;
    if (rawValue === ">" || rawValue === "|" || rawValue === ">-" || rawValue === "|-" || rawValue === ">+" || rawValue === "|+") {
      const block = parseBlockScalar(rawValue, lines, i + 1);
      value = block.value;
      i = block.nextIndex - 1;
    } else {
      value = parseYamlScalar(rawValue);
    }
    if (key === "name") frontmatter.name = value;
    else if (key === "description") frontmatter.description = value;
  }

  return { frontmatter, body: match[2] ?? "" };
}

export function buildSkillMarkdown(options: CreateSkillOptions): string {
  assertValidSkillName(options.name);
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

async function assertNotSymlink(filePath: string, label: string): Promise<void> {
  try {
    const entry = await lstat(filePath);
    if (entry.isSymbolicLink()) throw new CliUsageError(`${label} must not be a symlink: ${filePath}`);
    if (label === "Skill directory" && !entry.isDirectory()) throw new CliUsageError(`${label} must be a directory: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function writeSkillFile(filePath: string, content: string, force: boolean | undefined): Promise<void> {
  await assertNotSymlink(filePath, "Skill file");
  const flags = constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_TRUNC
    | constants.O_NOFOLLOW
    | (force ? 0 : constants.O_EXCL);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, flags, 0o600);
    await handle.writeFile(content, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CliUsageError(`Skill already exists at ${filePath}. Pass --force to overwrite.`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function createSkill(options: CreateSkillOptions): Promise<CreatedSkill> {
  assertValidSkillName(options.name);
  const skillsRoot = resolveSkillsRoot(options);
  const directory = skillDirectory(skillsRoot, options.name);
  const filePath = skillFilePath(skillsRoot, options.name);
  assertPathInside(skillsRoot, directory);
  assertPathInside(skillsRoot, filePath);

  if (await pathExists(filePath) && !options.force) {
    throw new CliUsageError(`Skill already exists at ${filePath}. Pass --force to overwrite.`);
  }

  await mkdir(skillsRoot, { recursive: true, mode: 0o700 });
  await assertNotSymlink(skillsRoot, "Skill directory");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNotSymlink(directory, "Skill directory");
  await writeSkillFile(filePath, buildSkillMarkdown(options), options.force);

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
    const entry = await lstat(filePath);
    if (!entry.isFile() || entry.isSymbolicLink()) return null;
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
