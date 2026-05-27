import { describe, expect, it } from "vitest";
import { renderDiff, renderFileEdit } from "../../src/render/diff.js";

const NUL = String.fromCharCode(0);

describe("renderDiff", () => {
  it("caps at 15 lines and reports the remainder", () => {
    const diff = Array.from({ length: 20 }, (_, i) => `+line ${i}`).join("\n");
    const out = renderDiff(diff);
    expect(out.split("\n").length).toBe(16); // 15 lines + the "more" tail
    expect(out).toContain("... +5 more lines");
  });
});

describe("renderFileEdit", () => {
  it("previews a new file as +-prefixed lines, capped at 5", () => {
    const after = Array.from({ length: 8 }, (_, i) => `line ${i}`).join("\n");
    const out = renderFileEdit({ path: "/home/u/proj/src/new.ts", after });
    expect(out).toContain("┌─ wrote /home/u/proj/src/new.ts ─");
    expect(out).toContain("+ line 0");
    expect(out).toContain("+ line 4");
    expect(out).not.toContain("+ line 5");
    expect(out).toContain("... +3 more lines");
  });

  it("renders a modified file as a bounded unified diff", () => {
    const out = renderFileEdit({ path: "src/a.ts", before: "old", after: "new", unifiedDiff: "@@ -1 +1 @@\n-old\n+new" });
    expect(out).toContain("┌─ src/a.ts ─");
    expect(out).toContain("-old");
    expect(out).toContain("+new");
  });

  it("summarizes binary writes with a size instead of content", () => {
    const out = renderFileEdit({ path: "assets/logo.png", after: `PNG${NUL}binary` });
    expect(out).toContain("wrote assets/logo.png (");
    expect(out).not.toContain("binary");
  });
});
