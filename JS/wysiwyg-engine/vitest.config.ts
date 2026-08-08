import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `environment` is set per-file via `// @vitest-environment` so pure-logic tests can stay on
    // Node and DOM-behavior tests can opt in to jsdom. Default to node for speed.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
