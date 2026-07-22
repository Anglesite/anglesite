import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server-tests/**/*.test.{ts,js}"],
    environment: "node",
    testTimeout: 10_000,
  },
});
