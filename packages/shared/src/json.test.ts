import { describe, expect, it } from "vitest";
import { jsonValueSchema, safeParse, safeStringify, type JsonValue } from "./json.js";

describe("jsonValueSchema", () => {
  it("round-trips a deeply nested JSON value through parse → stringify → schema", () => {
    const value: JsonValue = {
      str: "hello",
      num: 42,
      bool: true,
      nil: null,
      arr: [1, "two", false, null, { nested: ["a", { b: "c" }] }],
      obj: { empty: {}, list: [] },
    };

    const serialized = safeStringify(value);
    const reparsed = safeParse(serialized);

    expect(reparsed).toEqual(value);
    expect(() => jsonValueSchema.parse(reparsed)).not.toThrow();
  });

  it("rejects non-JSON values (functions, undefined fields, symbols)", () => {
    const badRecord: unknown = { undefined };
    expect(() => jsonValueSchema.parse(badRecord)).toThrow();
  });
});
