import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same resolution as tsconfig `paths` and tsup bundling: shared is source, not an npm dependency.
    alias: {
      "@meling/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    // Emulator tests need running emulators; they run with vitest.emulator.config.ts via `pnpm test:functions`.
    exclude: [...configDefaults.exclude, "**/*.emulator.test.ts"],
  },
});
