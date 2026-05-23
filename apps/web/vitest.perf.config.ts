import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Phase 14 — dedicated config for the perf benchmarks under `tests/perf/`.
// Kept separate from `vitest.config.ts` so the default `pnpm test` stays
// fast and predictable; perf rows have higher variance and are run
// explicitly via `pnpm test:perf`.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/perf/*.bench.ts", "tests/perf/*.bench.tsx"],
    environment: "jsdom",
    passWithNoTests: false,
  },
});
