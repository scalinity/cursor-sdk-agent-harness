import type { KnownLanguage } from "@harness/shared";
import type { Tree } from "@lezer/common";

export interface ParserLike {
  parse(input: string): Tree;
}

export type ParserRegistryEntry =
  | { kind: "lezer"; parser: ParserLike }
  | { kind: "shell-regex" }
  | { kind: "plain-text" };

const parserCache = new Map<KnownLanguage, Promise<ParserRegistryEntry>>();

async function loadLezerParser(language: KnownLanguage): Promise<ParserRegistryEntry> {
  if (language === "typescript") {
    const mod = await import("@lezer/javascript");
    return { kind: "lezer", parser: mod.parser.configure({ dialect: "ts jsx" }) };
  }
  if (language === "javascript") {
    const mod = await import("@lezer/javascript");
    return { kind: "lezer", parser: mod.parser.configure({ dialect: "jsx" }) };
  }
  if (language === "python") {
    const mod = await import("@lezer/python");
    return { kind: "lezer", parser: mod.parser };
  }
  if (language === "json") {
    const mod = await import("@lezer/json");
    return { kind: "lezer", parser: mod.parser };
  }
  if (language === "markdown") {
    const mod = await import("@lezer/markdown");
    return { kind: "lezer", parser: mod.parser };
  }
  if (language === "shell") {
    return { kind: "shell-regex" };
  }
  return { kind: "plain-text" };
}

export function getParserForLanguage(language: KnownLanguage): Promise<ParserRegistryEntry> {
  const cached = parserCache.get(language);
  if (cached !== undefined) return cached;
  const loaded = loadLezerParser(language);
  parserCache.set(language, loaded);
  return loaded;
}

export function clearParserCacheForTests(): void {
  parserCache.clear();
}
