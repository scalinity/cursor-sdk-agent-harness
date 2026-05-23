import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");

const componentCode = "import { useEffect } from 'react';\nexport function Foo() { useEffect(() => {}); return null; }\n";
const hookCode = "import { useEffect } from 'react';\nexport function useFoo() { useEffect(() => {}); }\n";

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
