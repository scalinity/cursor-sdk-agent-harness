import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import harness from "eslint-plugin-harness";

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

export default [
  {
    ignores: [
      "**/dist/**",
      "**/dist-electron/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.pnpm-store/**",
      "**/.claude/**",
      "**/.gyp-venv/**",
      "docs/mockup-rendered.html",
      "docs/mockup-design-dna.html",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    ...reactPlugin.configs.flat.recommended,
    ...reactPlugin.configs.flat["jsx-runtime"],
    settings: { react: { version: "19.0" } },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat["jsx-runtime"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/prop-types": "off",
    },
  },
  {
    files: ["apps/web/src/components/**/*.{ts,tsx}", "apps/web/src/pages/**/*.{ts,tsx}"],
    plugins: { harness },
    rules: {
      "harness/no-use-effect-in-components": "error",
      "harness/no-hardcoded-visuals": "error",
    },
  },
  {
    files: ["tooling/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.test.{js,ts,tsx,mjs}", "**/tests/**/*.{js,ts,tsx,mjs}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
