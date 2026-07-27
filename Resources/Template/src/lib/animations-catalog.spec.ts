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

      it("demo snapshot is fresh", async () => {
        const container = await AstroContainer.create();
        const mod = await import(
          /* @vite-ignore */ `@astroanimate/core/${entry.component}`
        );
        const inner = await container.renderToString(mod.default, {
          props: entry.props,
          slots: { default: `${entry.title} demo` },
        });
        // AstroContainer#renderToString only returns the component's own
        // markup (plus any define:vars inline styles) — it does not bundle
        // the component's scoped <style> block, since that extraction is
        // normally a Vite/build-time asset step the container API doesn't
        // run. Pull the component's real CSS straight from its source so
        // the demo actually animates offline, in a WKWebView, with no dev
        // server: every curated component's selectors are plain classes or
        // data-attributes (not Astro's :scope hash), so inlining the raw
        // rule set is safe for a page containing exactly one instance.
        const componentSource = readFileSync(
          `node_modules/@astroanimate/core/dist/components/${entry.component}/${entry.component}.astro`,
          "utf8",
        );
        const componentCss = [...componentSource.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map((match) => match[1])
          .join("\n");
        const page = [
          "<!doctype html>",
          `<html lang="en"><head><meta charset="utf-8"><title>${entry.title}</title>`,
          "<style>body{margin:0;display:grid;place-items:center;min-height:100vh;",
          "font-family:-apple-system,system-ui,sans-serif;background:Canvas;color:CanvasText;color-scheme:light dark}</style>",
          `<style>${componentCss}</style>`,
          "</head><body>",
          inner,
          "</body></html>",
          "",
        ].join("\n");
        await expect(page).toMatchFileSnapshot(
          `../../integrations/animations-demos/${entry.component}.html`,
        );
      });
    });
  }

  it("every curated component is documented", () => {
    const docs = readFileSync("integrations/docs/animations.md", "utf8");
    for (const entry of catalog.components) {
      expect(docs, entry.component).toContain(`## ${entry.component}`);
    }
  });
});
