import { describe, expect, it } from "vitest";
import {
  accessibilityNodeSchema,
  browserInvokeRequestSchema,
  browserPushEventSchema,
  browserStateSchema,
  browserWaitForInputSchema,
} from "./browser-protocol.js";

describe("browser-protocol", () => {
  it("parses a valid browser state", () => {
    const parsed = browserStateSchema.parse({
      agentId: "agent-1",
      exists: true,
      url: "https://example.com/",
      title: "Example",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      lastAction: "navigate example.com",
    });
    expect(parsed.url).toBe("https://example.com/");
    expect(parsed.canGoBack).toBe(true);
  });

  describe("browserInvokeRequestSchema discriminated union", () => {
    it("requires a url on navigate", () => {
      expect(
        browserInvokeRequestSchema.safeParse({ op: "navigate", agentId: "a" }).success,
      ).toBe(false);
      expect(
        browserInvokeRequestSchema.safeParse({
          op: "navigate",
          agentId: "a",
          url: "example.com",
        }).success,
      ).toBe(true);
    });

    it("requires a rect on position", () => {
      expect(
        browserInvokeRequestSchema.safeParse({ op: "position", agentId: "a" }).success,
      ).toBe(false);
      expect(
        browserInvokeRequestSchema.safeParse({
          op: "position",
          agentId: "a",
          rect: { x: 0, y: 0, width: 100, height: 50 },
        }).success,
      ).toBe(true);
    });

    it("accepts the minimal lifecycle ops", () => {
      for (const op of ["ensure", "back", "forward", "reload", "stop", "getState", "destroy", "hide"]) {
        expect(
          browserInvokeRequestSchema.safeParse({ op, agentId: "a" }).success,
        ).toBe(true);
      }
    });
  });

  it("round-trips a recursive accessibility tree", () => {
    const tree = {
      ref: "e1",
      role: "main",
      children: [
        { ref: "e2", role: "link", name: "Home" },
        { ref: "e3", role: "group", children: [{ ref: "e4", role: "button", name: "Go" }] },
      ],
    };
    const parsed = accessibilityNodeSchema.parse(tree);
    expect(parsed.children?.[1]?.children?.[0]?.name).toBe("Go");
  });

  describe("browserWaitForInputSchema", () => {
    it("rejects an empty wait (no text/ref/ms)", () => {
      expect(browserWaitForInputSchema.safeParse({}).success).toBe(false);
    });
    it("accepts a text wait", () => {
      expect(browserWaitForInputSchema.safeParse({ text: "Welcome" }).success).toBe(true);
    });
  });

  it("discriminates push events on kind", () => {
    const state = browserPushEventSchema.parse({
      kind: "state",
      agentId: "a",
      state: {
        agentId: "a",
        exists: false,
        url: "",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        lastAction: null,
      },
    });
    expect(state.kind).toBe("state");

    const action = browserPushEventSchema.parse({
      kind: "action",
      agentId: "a",
      action: { type: "navigate", url: "https://x.test/" },
    });
    expect(action.kind).toBe("action");
  });
});
