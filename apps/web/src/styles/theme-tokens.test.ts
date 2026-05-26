import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesDir = resolve(__dirname);

function readStyleFile(name: string): string {
  return readFileSync(resolve(stylesDir, name), "utf8");
}

function collectTokens(css: string, selector: string): Set<string> {
  const blockMatch = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\}`));
  if (!blockMatch?.[1]) return new Set();
  return new Set([...blockMatch[1].matchAll(/--[a-z0-9-]+\s*:/gi)].map((match) => match[0].slice(0, -1).trim()));
}

function collectReferencedTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]!));
}

function concreteThemeTokens(css: string): Set<string> {
  const blockMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
  const block = blockMatch?.[1] ?? "";
  const tokens = new Set<string>();
  for (const match of block.matchAll(/(--(?:color|term|shadow)-[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = match[1]!;
    const value = match[2] ?? "";
    if (!value.includes("var(")) tokens.add(name);
  }
  return tokens;
}

function tokenValue(css: string, selector: string, token: string): string | null {
  const blockMatch = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\}`));
  const block = blockMatch?.[1] ?? "";
  const tokenMatch = block.match(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`));
  return tokenMatch?.[1]?.trim() ?? null;
}

const STYLE_FILES = ["tokens.css", "tokens-light.css", "tailwind.css", "app-shell.css"] as const;

describe("light theme tokens", () => {
  it("overrides concrete theme tokens while inheriting static layout tokens", () => {
    const darkCss = readStyleFile("tokens.css");
    const darkTokens = concreteThemeTokens(darkCss);
    const lightTokens = collectTokens(readStyleFile("tokens-light.css"), '[data-theme="light"]');

    expect(lightTokens.size).toBeGreaterThan(0);
    expect([...darkTokens].filter((token) => !lightTokens.has(token))).toEqual([]);
  });

  it("does not reference undefined CSS custom properties", () => {
    const cssByFile = STYLE_FILES.map((name) => [name, readStyleFile(name)] as const);
    const declaredTokens = new Set<string>();
    for (const [, css] of cssByFile) {
      for (const token of collectTokens(css, ":root")) declaredTokens.add(token);
      for (const token of collectTokens(css, '[data-theme="light"]')) declaredTokens.add(token);
    }

    const missing = new Set<string>();
    for (const [name, css] of cssByFile) {
      if (name === "tailwind.css") continue;
      for (const token of collectReferencedTokens(css)) {
        if (!declaredTokens.has(token)) missing.add(token);
      }
    }

    expect([...missing]).toEqual([]);
  });

  it("maps terminal bright-white to the orange accent for branded terminal output", () => {
    expect(tokenValue(readStyleFile("tokens.css"), ":root", "--term-bright-white")).toBe(
      "var(--color-accent-primary)",
    );
    expect(
      tokenValue(readStyleFile("tokens-light.css"), '[data-theme="light"]', "--term-bright-white"),
    ).toBe("var(--color-accent-primary)");
  });
});
