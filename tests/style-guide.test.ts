import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const styleGuidePath = resolve(__dirname, "../docs/style-guide.md");

describe("style guide", () => {
  it("exists at docs/style-guide.md", () => {
    expect(existsSync(styleGuidePath), "docs/style-guide.md is missing").toBe(
      true,
    );
  });

  describe("required sections", () => {
    const content = existsSync(styleGuidePath)
      ? readFileSync(styleGuidePath, "utf-8")
      : "";

    const requiredSections = [
      "Design principles",
      "HTML",
      "CSS",
      "TypeScript",
    ];

    it.each(requiredSections)("has a '%s' section", (section) => {
      const pattern = new RegExp(`^#{1,3}\\s+${section}`, "m");
      expect(content).toMatch(pattern);
    });

    const requiredTopics = [
      ["shared component", /shared\s+component|reusable\s+component/i],
      ["class naming", /class\s+naming|BEM|naming\s+convention/i],
      ["accessibility", /accessibility|a11y|WCAG/i],
      ["design tokens", /design\s+token|custom\s+propert|CSS\s+variable/i],
      ["scoped vs global styles", /scoped.*global|global.*scoped/i],
      ["responsive", /responsive|breakpoint|mobile.first/i],
      ["strict mode", /strict\s+mode|astro\/tsconfigs\/strict/i],
      ["prop typing", /interface\s+Props|prop\s+typ/i],
      ["data file patterns", /content\s+collection|src\/data|src\/content/i],
    ] as const;

    it.each(requiredTopics)("covers %s", (_label, pattern) => {
      expect(content).toMatch(pattern);
    });
  });
});
