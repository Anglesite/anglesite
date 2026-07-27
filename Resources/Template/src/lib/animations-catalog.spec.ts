import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadAnimationsCatalog } from "../../scripts/animations-catalog";

const catalog = loadAnimationsCatalog();

describe("animations catalog", () => {
  it("has at least one curated component", () => {
    expect(catalog.components.length).toBeGreaterThan(0);
  });

  it("never catalogs enhance=true (CSP: no inline scripts)", () => {
    for (const entry of catalog.components) {
      expect(entry.props["enhance"], entry.component).not.toBe(true);
      expect(entry.snippet).not.toContain("enhance={true}");
      expect(entry.snippet).not.toContain('enhance="true"');
    }
  });

  for (const entry of catalog.components) {
    describe(entry.component, () => {
      it("renders, is script-free, and guards reduced motion", async () => {
        const container = await AstroContainer.create();
        const mod = await import(
          /* @vite-ignore */ `@astroanimate/core/${entry.component}`
        );
        const html = await container.renderToString(mod.default, {
          props: entry.props,
          slots: { default: "Sample content" },
        });
        expect(html.length).toBeGreaterThan(0);
        // Astro preserves top-level template comments in the compiled output,
        // and several components' comments describe their conditional
        // <script> paths (e.g. "Script emitted ONLY when enhance=true") —
        // strip comments first so the check targets real <script> elements,
        // not comment prose that happens to mention the tag.
        const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
        expect(htmlWithoutComments).not.toContain("<script");
        const source = readFileSync(
          `node_modules/@astroanimate/core/dist/components/${entry.component}/${entry.component}.astro`,
          "utf8",
        );
        expect(source).toContain("prefers-reduced-motion");
      });
    });
  }
});
