import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectRule, RuleScope } from "@harness/shared";
import { minimatch } from "minimatch";

const RULES_DIR = ".harness/rules";

interface RuleFrontmatter {
  name?: string;
  scope?: string;
  glob?: string;
  description?: string;
}

function parseFrontmatter(raw: string): { frontmatter: RuleFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const yamlBlock = match[1]!;
  const body = match[2]!;
  const frontmatter: RuleFrontmatter = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key === "name") frontmatter.name = value;
    else if (key === "scope") frontmatter.scope = value;
    else if (key === "glob") frontmatter.glob = value;
    else if (key === "description") frontmatter.description = value;
  }

  return { frontmatter, body };
}

function isValidScope(s: string): s is RuleScope {
  return s === "always" || s === "glob" || s === "manual";
}

export async function readRulesFromWorkspace(
  workspaceRoot: string,
  logger?: { warn: (obj: unknown, msg: string) => void },
): Promise<ProjectRule[]> {
  const rulesDir = path.join(workspaceRoot, RULES_DIR);

  let entries: string[];
  try {
    entries = await fs.readdir(rulesDir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((e) => e.endsWith(".md")).sort();
  const rules: ProjectRule[] = [];

  for (const filename of mdFiles) {
    const filePath = path.join(rulesDir, filename);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      logger?.warn({ filePath }, "Could not read rule file, skipping");
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(raw);

    if (!frontmatter.name || !frontmatter.scope || !frontmatter.description) {
      logger?.warn({ filePath }, "Rule file missing required frontmatter (name/scope/description), skipping");
      continue;
    }

    if (!isValidScope(frontmatter.scope)) {
      logger?.warn({ filePath, scope: frontmatter.scope }, "Invalid rule scope, skipping");
      continue;
    }

    if (frontmatter.scope === "glob" && !frontmatter.glob) {
      logger?.warn({ filePath }, "Glob-scoped rule missing glob pattern, skipping");
      continue;
    }

    if (frontmatter.scope === "glob" && frontmatter.glob) {
      try {
        minimatch("test", frontmatter.glob);
      } catch {
        logger?.warn({ filePath, glob: frontmatter.glob }, "Malformed glob pattern, skipping");
        continue;
      }
    }

    rules.push({
      name: frontmatter.name,
      scope: frontmatter.scope,
      glob: frontmatter.glob,
      description: frontmatter.description,
      content: body.trim(),
      filePath: path.relative(workspaceRoot, filePath),
    });
  }

  // Sort: always first, then glob, then manual
  const scopeOrder: Record<RuleScope, number> = { always: 0, glob: 1, manual: 2 };
  rules.sort((a, b) => scopeOrder[a.scope] - scopeOrder[b.scope]);

  return rules;
}

export function resolveRulesForRun(
  allRules: ProjectRule[],
  mentionedPaths: string[],
  mentionedRuleNames: string[],
): ProjectRule[] {
  const resolved: ProjectRule[] = [];
  const seen = new Set<string>();

  for (const rule of allRules) {
    if (seen.has(rule.name)) continue;

    if (rule.scope === "always") {
      seen.add(rule.name);
      resolved.push(rule);
      continue;
    }

    if (rule.scope === "glob" && rule.glob) {
      const matches = mentionedPaths.some((p) => minimatch(p, rule.glob!));
      if (matches) {
        seen.add(rule.name);
        resolved.push(rule);
      }
      continue;
    }

    if (rule.scope === "manual") {
      if (mentionedRuleNames.includes(rule.name)) {
        seen.add(rule.name);
        resolved.push(rule);
      }
    }
  }

  return resolved;
}

export function assembleRulesBlock(rules: ProjectRule[]): string {
  if (rules.length === 0) return "";

  const sections = rules.map(
    (r) => `## ${r.name}: ${r.description}\n${r.content}`,
  );

  return `<project-rules>\n${sections.join("\n\n---\n")}\n</project-rules>`;
}
