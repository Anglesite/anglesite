import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const templatePkg = JSON.parse(
  readFileSync(resolve(__dirname, "../template/package.json"), "utf-8"),
);

describe("template/package.json", () => {
  it("has @astrojs/check in devDependencies so astro check runs non-interactively", () => {
    expect(templatePkg.devDependencies).toHaveProperty("@astrojs/check");
  });

  it("has typescript in devDependencies (required by @astrojs/check)", () => {
    expect(templatePkg.devDependencies).toHaveProperty("typescript");
  });

  it("has a check script that runs astro check", () => {
    expect(templatePkg.scripts.check).toBe("astro check");
  });
});
