import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const templateDir = resolve(__dirname, "../template");
const configPath = join(templateDir, ".markdownlint.jsonc");

describe("markdownlint configuration", () => {
  it("config exists at template/.markdownlint.jsonc", () => {
    expect(existsSync(configPath)).toBe(true);
  });

  it("config disables line-length rule (MD013)", () => {
    const raw = readFileSync(configPath, "utf-8");
    // Strip JSONC comments before parsing
    const json = raw.replace(/\/\/.*$/gm, "");
    const config = JSON.parse(json);
    expect(config.MD013).toBe(false);
  });

  it("template/package.json includes markdownlint-cli2 devDependency", () => {
    const pkg = JSON.parse(
      readFileSync(join(templateDir, "package.json"), "utf-8"),
    );
    expect(pkg.devDependencies).toHaveProperty("markdownlint-cli2");
  });

  it("template/package.json has a lint:md script", () => {
    const pkg = JSON.parse(
      readFileSync(join(templateDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts["lint:md"]).toBeDefined();
    expect(pkg.scripts["lint:md"]).toContain("markdownlint-cli2");
  });
});

describe("template markdown passes markdownlint", () => {
  it("all markdown files pass lint", () => {
    const result = execFileSync(
      "npx",
      [
        "markdownlint-cli2",
        "--config",
        configPath,
        "template/**/*.md",
      ],
      {
        cwd: resolve(__dirname, ".."),
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    expect(result).toContain("0 error(s)");
  });
});
