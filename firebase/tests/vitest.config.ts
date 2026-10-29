import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run via `pnpm test:rules` from the repo root, which starts the emulators.
    include: ["*.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
