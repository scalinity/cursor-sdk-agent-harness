import { describe, expect, it } from "vitest";
import {
  DEFAULT_HARNESS_SERVER_URL,
  rendererServerOrigin,
  resolveHarnessServerUrl,
} from "../src/server-url.js";

describe("resolveHarnessServerUrl", () => {
  it("defaults to loopback 4783", () => {
    expect(resolveHarnessServerUrl({})).toBe(DEFAULT_HARNESS_SERVER_URL);
  });

  it("reads HARNESS_SERVER_URL and strips trailing slash", () => {
    expect(
      resolveHarnessServerUrl({ HARNESS_SERVER_URL: "http://127.0.0.1:9999/" }),
    ).toBe("http://127.0.0.1:9999");
  });
});

describe("rendererServerOrigin", () => {
  it("returns null in dev so Vite proxy handles API/WS", () => {
    expect(rendererServerOrigin(true, { HARNESS_SERVER_URL: "http://127.0.0.1:1" })).toBeNull();
  });

  it("returns the resolved server URL in packaged mode", () => {
    expect(rendererServerOrigin(false, { HARNESS_SERVER_URL: "http://127.0.0.1:4783" })).toBe(
      "http://127.0.0.1:4783",
    );
  });
});
