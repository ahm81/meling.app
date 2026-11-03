import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same resolution as tsconfig `paths` and tsup bundling: shared is source, not an npm dependency.
    alias: {
      "@meling/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
});
