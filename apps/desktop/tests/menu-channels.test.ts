import { desktopMenuChannels } from "@harness/shared";
import { describe, expect, it } from "vitest";
import { mainProcessMenuChannels } from "../src/menu.js";

describe("desktop menu IPC channels", () => {
  it("main process menu channels match shared desktopMenuChannels", () => {
    expect([...mainProcessMenuChannels]).toEqual([...desktopMenuChannels]);
  });

  it("includes menu:new-agent for File → New Agent (⌘N)", () => {
    expect(desktopMenuChannels).toContain("menu:new-agent");
    expect(desktopMenuChannels).not.toContain("menu:new-session");
  });
});
