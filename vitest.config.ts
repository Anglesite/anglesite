import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Map template/scripts imports to the actual source
      "./config.js": resolve(__dirname, "template/scripts/config.ts"),
      "./platform.js": resolve(__dirname, "template/scripts/platform.ts"),
      // Stub template devDependencies so resolution is consistent whether or
      // not `template/node_modules` is populated. Tests use `vi.mock` to
      // substitute behavior; without these aliases, `template/scripts/*.ts`
      // would resolve the real packages from a nested node_modules and the
      // mock registry (keyed by the test file's resolved path) wouldn't match.
      satori: resolve(__dirname, "tests/__stubs__/satori.ts"),
      "@resvg/resvg-js": resolve(__dirname, "tests/__stubs__/resvg.ts"),
      sharp: resolve(__dirname, "tests/__stubs__/sharp.ts"),
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
