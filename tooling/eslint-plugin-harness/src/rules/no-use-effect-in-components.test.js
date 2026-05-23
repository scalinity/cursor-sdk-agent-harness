import { describe, expect, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-use-effect-in-components.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

describe("no-use-effect-in-components", () => {
  it("flags direct useEffect calls and ignores other hook calls", () => {
    tester.run("no-use-effect-in-components", rule, {
      valid: [
        { code: "import { useState } from 'react'; const x = useState(0);" },
        { code: "useMemo(() => 1, []);" },
        { code: "useMountEffect(() => {});" },
        { code: "obj.useEffectLike();" },
      ],
      invalid: [
        {
          code: "useEffect(() => {});",
          errors: [{ messageId: "noUseEffect" }],
        },
        {
          code: "import * as React from 'react'; React.useEffect(() => {});",
          errors: [{ messageId: "noUseEffect" }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});
