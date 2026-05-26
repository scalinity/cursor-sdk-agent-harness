import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(dirname(fileURLToPath(import.meta.url)), "app-shell.css");

function cssRule(selector: string): string {
  const css = readFileSync(stylesPath, "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`).exec(css);
  return match?.groups?.body ?? "";
}

describe("app shell styles", () => {
  it("keeps the standalone settings page scrollable under the root overflow lock", () => {
    const rootRule = cssRule("html,\nbody,\n#root");
    const settingsRule = cssRule(".settings-page");

    expect(rootRule).toContain("overflow: hidden");
    expect(settingsRule).toContain("height: 100dvh");
    expect(settingsRule).toContain("overflow-y: auto");
  });
});
