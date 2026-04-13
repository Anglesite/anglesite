import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Map template/scripts imports to the actual source
      "./config.js": resolve(__dirname, "template/scripts/config.ts"),
      "./platform.js": resolve(__dirname, "template/scripts/platform.ts"),
    },
  },
  esbuild: {
    // Bypass template/tsconfig.json (which extends astro/tsconfigs/strict)
    // by providing raw compiler options instead of file-based resolution
    tsconfigRaw: "{}",
  },
  test: {
    include: ["tests/**/*.test.ts", "test/**/*.test.js"],
    environment: "node",
    testTimeout: 10_000,
  },
});
