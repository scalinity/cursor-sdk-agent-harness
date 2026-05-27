import { readFile } from "node:fs/promises";
import { CliUsageError } from "../errors.js";
import { writeJsonLine } from "../output/json.js";
import { renderTable } from "../output/table.js";
import {
  createSkill,
  listSkills,
  type CreatedSkill,
  type SkillSummary,
} from "../lib/skills.js";
import type { CommandDeps } from "../types.js";

export interface SkillsListOptions {
  workspace?: string;
  global?: boolean;
  json?: boolean;
}

export interface SkillCreateOptions {
  name: string;
  description?: string;
  content?: string;
  file?: string;
  paths?: string[];
  manual?: boolean;
  global?: boolean;
  workspace?: string;
  force?: boolean;
  json?: boolean;
}

export async function listSkillsCommand(
  options: SkillsListOptions,
  deps: Pick<CommandDeps, "write">,
): Promise<SkillSummary[]> {
  const skills = await listSkills({
    ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
    ...(options.global !== undefined ? { global: options.global } : {}),
  });
  if (options.json) {
    for (const skill of skills) writeJsonLine(deps.write, { type: "skill", skill });
    return skills;
  }

  if (skills.length === 0) {
    deps.write("No skills found.");
    return skills;
  }

  deps.write(renderTable(skills, [
    { key: "name", header: "Name", value: (skill) => skill.name, maxWidth: 28 },
    { key: "scope", header: "Scope", value: (skill) => skill.scope },
    { key: "description", header: "Description", value: (skill) => skill.description, maxWidth: 48 },
    { key: "path", header: "Path", value: (skill) => skill.filePath, maxWidth: 56 },
  ]));
  return skills;
}

export async function createSkillCommand(
  options: SkillCreateOptions,
  deps: Pick<CommandDeps, "write">,
): Promise<CreatedSkill> {
  const description = options.description?.trim();
  if (!description) {
    throw new CliUsageError("Usage: harness skills create <name> --description <text>");
  }

  let content = options.content;
  if (options.file && options.content !== undefined) {
    throw new CliUsageError("Use either --content or --file, not both.");
  }
  if (options.file) {
    content = await readFile(options.file, "utf8");
  }

  const created = await createSkill({
    name: options.name,
    description,
    ...(content !== undefined ? { content } : {}),
    ...(options.paths !== undefined ? { paths: options.paths } : {}),
    ...(options.manual !== undefined ? { manual: options.manual } : {}),
    ...(options.global !== undefined ? { global: options.global } : {}),
    ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
  });

  if (options.json) {
    writeJsonLine(deps.write, { type: "skill_created", skill: created });
  } else {
    deps.write(`Created skill ${created.name} (${created.scope}) at ${created.filePath}`);
  }
  return created;
}

export function parseSkillPaths(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const paths = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return paths.length > 0 ? paths : undefined;
}
