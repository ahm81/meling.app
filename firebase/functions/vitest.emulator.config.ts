import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Run via `pnpm test:functions` from the repo root, which starts the Firestore and Storage emulators.
export default defineConfig({
  resolve: {
    alias: {
      "@meling/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.emulator.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
