import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");

const componentCode = "import { useEffect } from 'react';\nexport function Foo() { useEffect(() => {}); return null; }\n";
const hookCode = "import { useEffect } from 'react';\nexport function useFoo() { useEffect(() => {}); }\n";

const hardcodedColorComponent =
  "export function Bad() { return <div className=\"bg-[#231e1a] text-[14px]\" style={{ color: 'red' }} />; }\n";
const tokenCleanComponent =
  "export function Good() { return <div className=\"bg-surface-1 text-text-primary rounded-md\" />; }\n";

describe("eslint flat config — no-use-effect-in-components wiring", () => {
  it("flags useEffect under apps/web/src/components and is silent under apps/web/src/hooks", async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
      errorOnUnmatchedPattern: false,
    });

    const componentResults = await eslint.lintText(componentCode, {
      filePath: path.join(repoRoot, "apps/web/src/components/__virtual.tsx"),
    });
    const componentMessages = componentResults.flatMap((r) => r.messages);
    const componentHits = componentMessages.filter(
      (m) => m.ruleId === "harness/no-use-effect-in-components",
    );
    expect(componentHits).toHaveLength(1);

    const hookResults = await eslint.lintText(hookCode, {
      filePath: path.join(repoRoot, "apps/web/src/hooks/__virtual.ts"),
    });
    const hookMessages = hookResults.flatMap((r) => r.messages);
    const hookHits = hookMessages.filter(
      (m) => m.ruleId === "harness/no-use-effect-in-components",
    );
    expect(hookHits).toHaveLength(0);
  });
});

describe("eslint flat config — no-hardcoded-visuals wiring", () => {
  it("flags hex colours, raw px, and inline style props under components/pages", async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
      errorOnUnmatchedPattern: false,
    });

    const results = await eslint.lintText(hardcodedColorComponent, {
      filePath: path.join(repoRoot, "apps/web/src/components/__bad.tsx"),
    });
    const messages = results.flatMap((r) => r.messages);
    const hits = messages.filter((m) => m.ruleId === "harness/no-hardcoded-visuals");
    // Hex + raw px size in the className string, plus the inline style.
    // All three should surface in one pass.
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.some((m) => m.messageId === "arbitraryColor")).toBe(true);
    expect(hits.some((m) => m.messageId === "arbitrarySize")).toBe(true);
    expect(hits.some((m) => m.messageId === "inlineStyle")).toBe(true);
  });

  it("is silent on token-clean component code", async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
      errorOnUnmatchedPattern: false,
    });

    const results = await eslint.lintText(tokenCleanComponent, {
      filePath: path.join(repoRoot, "apps/web/src/components/__good.tsx"),
    });
    const messages = results.flatMap((r) => r.messages);
    const hits = messages.filter((m) => m.ruleId === "harness/no-hardcoded-visuals");
    expect(hits).toHaveLength(0);
  });

  it("does not run on files outside components/pages", async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
      errorOnUnmatchedPattern: false,
    });

    const results = await eslint.lintText(hardcodedColorComponent, {
      filePath: path.join(repoRoot, "apps/web/src/hooks/__off-scope.tsx"),
    });
    const messages = results.flatMap((r) => r.messages);
    const hits = messages.filter((m) => m.ruleId === "harness/no-hardcoded-visuals");
    expect(hits).toHaveLength(0);
  });
});
