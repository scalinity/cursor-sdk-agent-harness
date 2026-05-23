import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/perf/*.bench.ts", "tests/perf/*.bench.tsx"],
    environment: "jsdom",
    passWithNoTests: false,
  },
});
