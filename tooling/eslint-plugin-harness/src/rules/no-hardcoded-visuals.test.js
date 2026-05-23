import { describe, expect, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-hardcoded-visuals.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

describe("no-hardcoded-visuals", () => {
  it("flags hex colours, color functions, raw px sizes, and inline style props", () => {
    tester.run("no-hardcoded-visuals", rule, {
      valid: [
        // Plain token-backed Tailwind utilities are fine.
        { code: "const cls = 'bg-accent-primary text-text-primary rounded-md';" },
        // Data/aria variant selectors use brackets but no colour or unit.
        { code: "const cls = 'data-[selected=true]:bg-accent-bg aria-[busy=true]:cursor-progress';" },
        // Documentation strings with OKLCH text but no Tailwind bracket are not classes.
        { code: "const value = 'oklch(0.945 0.006 80)';" },
        // OpenType feature settings (CSS feature names in brackets, no colour/unit).
        { code: "const fs = 'font-feature-settings: \"ss01\", \"cv11\"';" },
        // Inline style with non-visual props (e.g. accessibility/role) is permitted.
        {
          code: "const el = <div style={{ pointerEvents: 'none' }} />;",
        },
      ],
      invalid: [
        // Hex colour in className
        {
          code: "const cls = 'bg-[#231e1a] text-text-primary';",
          errors: [{ messageId: "arbitraryColor" }],
        },
        // OKLCH colour in className
        {
          code: "const cls = 'border-[oklch(0.5_0.1_72)]';",
          errors: [{ messageId: "arbitraryColor" }],
        },
        // Raw px size in className
        {
          code: "const cls = 'p-[13px] gap-2';",
          errors: [{ messageId: "arbitrarySize" }],
        },
        // Raw text size in className
        {
          code: "const cls = 'text-[14px] mono';",
          errors: [{ messageId: "arbitrarySize" }],
        },
        // Inline style with `color`
        {
          code: "const el = <div style={{ color: 'red' }} />;",
          errors: [{ messageId: "inlineStyle" }],
        },
        // Inline style with `padding`
        {
          code: "const el = <div style={{ padding: '12px' }} />;",
          errors: [{ messageId: "inlineStyle" }],
        },
        // Inline style with `fontSize`
        {
          code: "const el = <div style={{ fontSize: 14 }} />;",
          errors: [{ messageId: "inlineStyle" }],
        },
        // Template literal with hex
        {
          code: "const cls = `bg-[#fff] ${other}`;",
          errors: [{ messageId: "arbitraryColor" }],
        },
        // Multiple violations in a single string should all surface.
        {
          code: "const cls = 'bg-[#fff] p-[13px] text-[14px]';",
          errors: [
            { messageId: "arbitraryColor" },
            { messageId: "arbitrarySize" },
            { messageId: "arbitrarySize" },
          ],
        },
      ],
    });
    expect(true).toBe(true);
  });
});
