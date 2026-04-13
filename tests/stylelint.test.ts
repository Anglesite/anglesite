import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const templateDir = resolve(__dirname, "../template");
const configPath = join(templateDir, ".stylelintrc.json");
const stylesDir = join(templateDir, "src/styles");

describe("stylelint configuration", () => {
  it("config exists at template/.stylelintrc.json", () => {
    expect(existsSync(configPath)).toBe(true);
  });

  it("config is valid JSON", () => {
    const raw = readFileSync(configPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("config loads the declaration-strict-value plugin", () => {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.plugins).toContain("stylelint-declaration-strict-value");
  });

  it("config enforces tokens for color, background, font-size, and border-radius", () => {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const [properties] =
      config.rules["scale-unlimited/declaration-strict-value"];
    expect(properties).toContain("color");
    expect(properties).toContain("background");
    expect(properties).toContain("font-size");
    expect(properties).toContain("border-radius");
  });

  it("template/package.json includes stylelint devDependencies", () => {
    const pkg = JSON.parse(
      readFileSync(join(templateDir, "package.json"), "utf-8"),
    );
    expect(pkg.devDependencies).toHaveProperty("stylelint");
    expect(pkg.devDependencies).toHaveProperty(
      "stylelint-declaration-strict-value",
    );
  });

  it("template/package.json has a lint:css script", () => {
    const pkg = JSON.parse(
      readFileSync(join(templateDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts["lint:css"]).toBeDefined();
    expect(pkg.scripts["lint:css"]).toContain("stylelint");
  });
});

describe("template CSS passes stylelint", () => {
  const cssFiles = readdirSync(stylesDir)
    .filter((f) => f.endsWith(".css"))
    .map((name) => ({
      name,
      path: join(stylesDir, name),
    }));

  it("discovers at least one stylesheet", () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it.each(cssFiles.map((f) => [f.name, f.path]))(
    "%s passes lint",
    async (_name, filePath) => {
      const stylelint = await import("stylelint");
      const result = await stylelint.default.lint({
        files: filePath,
        configFile: configPath,
      });
      const errors = result.results.flatMap((r) =>
        r.warnings.filter((w) => w.severity === "error"),
      );
      if (errors.length > 0) {
        const messages = errors
          .map((e) => `  line ${e.line}: ${e.text}`)
          .join("\n");
        expect.fail(`${errors.length} stylelint errors:\n${messages}`);
      }
    },
  );
});
