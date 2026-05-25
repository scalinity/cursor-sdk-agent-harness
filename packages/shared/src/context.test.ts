import { describe, expect, it } from "vitest";
import {
  contextMentionKindSchema,
  contextMentionSchema,
  contextChipSchema,
  contextSearchResultSchema,
  contextResolveRequestSchema,
  contextResolveResponseSchema,
  ruleScopeSchema,
  projectRuleSchema,
  grepSearchQuerySchema,
  grepSearchResultSchema,
  fileSearchQuerySchema,
  fileSearchResultSchema,
  contextSearchQuerySchema,
} from "./context.js";

describe("contextMentionKindSchema", () => {
  it("accepts valid kinds", () => {
    for (const kind of ["file", "folder", "symbol", "codebase", "rules"]) {
      expect(contextMentionKindSchema.parse(kind)).toBe(kind);
    }
  });
  it("rejects invalid kind", () => {
    expect(() => contextMentionKindSchema.parse("invalid")).toThrow();
  });
});

describe("contextMentionSchema", () => {
  it("parses a file mention", () => {
    const result = contextMentionSchema.parse({
      kind: "file",
      value: "src/index.ts",
      displayLabel: "index.ts",
    });
    expect(result.kind).toBe("file");
    expect(result.value).toBe("src/index.ts");
    expect(result.resolvedContent).toBeUndefined();
  });

  it("parses a mention with resolvedContent", () => {
    const result = contextMentionSchema.parse({
      kind: "symbol",
      value: "MyFunction",
      displayLabel: "MyFunction",
      resolvedContent: "function MyFunction() {}",
    });
    expect(result.resolvedContent).toBe("function MyFunction() {}");
  });

  it("rejects missing required fields", () => {
    expect(() => contextMentionSchema.parse({ kind: "file" })).toThrow();
  });
});

describe("contextChipSchema", () => {
  it("parses a chip with token estimate", () => {
    const result = contextChipSchema.parse({
      id: "chip-1",
      mention: { kind: "file", value: "src/foo.ts", displayLabel: "foo.ts" },
      tokenEstimate: 1500,
    });
    expect(result.id).toBe("chip-1");
    expect(result.tokenEstimate).toBe(1500);
  });

  it("tokenEstimate is optional", () => {
    const result = contextChipSchema.parse({
      id: "chip-2",
      mention: { kind: "folder", value: "src/", displayLabel: "src" },
    });
    expect(result.tokenEstimate).toBeUndefined();
  });
});

describe("contextSearchResultSchema", () => {
  it("parses empty results", () => {
    const result = contextSearchResultSchema.parse({ files: [], symbols: [] });
    expect(result.files).toHaveLength(0);
    expect(result.symbols).toHaveLength(0);
  });

  it("parses results with files and symbols", () => {
    const result = contextSearchResultSchema.parse({
      files: [{ path: "src/a.ts", name: "a.ts", isDirectory: false, size: 100 }],
      symbols: [
        { name: "foo", kind: "function", path: "src/a.ts", line: 5, preview: "function foo() {}" },
      ],
    });
    expect(result.files).toHaveLength(1);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0]!.kind).toBe("function");
  });
});

describe("contextResolveRequestSchema", () => {
  it("parses with mentions", () => {
    const result = contextResolveRequestSchema.parse({
      mentions: [{ kind: "file", value: "a.ts", displayLabel: "a.ts" }],
    });
    expect(result.mentions).toHaveLength(1);
  });
});

describe("contextResolveResponseSchema", () => {
  it("parses response", () => {
    const result = contextResolveResponseSchema.parse({
      resolved: [
        {
          mention: { kind: "file", value: "a.ts", displayLabel: "a.ts" },
          content: "file content",
          tokenEstimate: 100,
          truncated: false,
        },
      ],
      totalTokenEstimate: 100,
    });
    expect(result.resolved).toHaveLength(1);
    expect(result.totalTokenEstimate).toBe(100);
  });
});

describe("ruleScopeSchema", () => {
  it("accepts valid scopes", () => {
    for (const scope of ["always", "glob", "manual"]) {
      expect(ruleScopeSchema.parse(scope)).toBe(scope);
    }
  });
  it("rejects invalid scope", () => {
    expect(() => ruleScopeSchema.parse("auto")).toThrow();
  });
});

describe("projectRuleSchema", () => {
  it("parses a valid rule", () => {
    const result = projectRuleSchema.parse({
      name: "test-rule",
      scope: "always",
      description: "A test rule",
      content: "Do something",
      filePath: ".harness/rules/test.md",
    });
    expect(result.name).toBe("test-rule");
    expect(result.glob).toBeUndefined();
  });
});

describe("grepSearchQuerySchema", () => {
  it("parses with defaults", () => {
    const result = grepSearchQuerySchema.parse({ q: "foo" });
    expect(result.q).toBe("foo");
    expect(result.maxResults).toBe(50);
    expect(result.caseSensitive).toBe(false);
  });
  it("rejects empty query", () => {
    expect(() => grepSearchQuerySchema.parse({ q: "" })).toThrow();
  });
});

describe("grepSearchResultSchema", () => {
  it("parses results", () => {
    const result = grepSearchResultSchema.parse({
      results: [],
      totalMatches: 0,
      truncated: false,
      durationMs: 42,
    });
    expect(result.durationMs).toBe(42);
  });
});

describe("fileSearchQuerySchema", () => {
  it("parses with defaults", () => {
    const result = fileSearchQuerySchema.parse({ pattern: "*.ts" });
    expect(result.maxResults).toBe(30);
  });
});

describe("fileSearchResultSchema", () => {
  it("parses results", () => {
    const result = fileSearchResultSchema.parse({
      files: [{ path: "a.ts", name: "a.ts", size: 100, modifiedAt: "2025-01-01T00:00:00Z" }],
      truncated: false,
    });
    expect(result.files).toHaveLength(1);
  });
});

describe("contextSearchQuerySchema", () => {
  it("parses with query", () => {
    const result = contextSearchQuerySchema.parse({ q: "test" });
    expect(result.q).toBe("test");
    expect(result.kinds).toBeUndefined();
  });
});
