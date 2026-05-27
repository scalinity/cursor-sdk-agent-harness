import { describe, expect, it } from "vitest";
import { CliHttpError } from "../src/client/http.js";
import { CliUsageError, formatCliError } from "../src/errors.js";

describe("formatCliError", () => {
  const networkError = new CliHttpError("network error", 0, "NETWORK_ERROR", null);

  it("guides embedded-mode network failures without telling the user to start a server", () => {
    const { message, exitCode } = formatCliError(networkError, "http://127.0.0.1:4783", true);
    expect(message).toContain("embedded");
    expect(message).not.toContain("pnpm start:server");
    expect(exitCode).toBe(2);
  });

  it("points external-server network failures at the configured URL", () => {
    const { message, exitCode } = formatCliError(networkError, "http://127.0.0.1:9999", false);
    expect(message).toContain("http://127.0.0.1:9999");
    expect(message).toContain("pnpm start:server");
    expect(exitCode).toBe(2);
  });

  it("passes usage errors through unchanged", () => {
    const { message, exitCode } = formatCliError(new CliUsageError("bad flag"));
    expect(message).toBe("bad flag");
    expect(exitCode).toBe(1);
  });
});
