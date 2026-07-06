import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildComponentModel } from "../server/component-model.mjs";

const CARD = `---
interface Props {
  title: string;
  count?: number;
}
const { title, count = 1 } = Astro.props;
---
<article class="card">
  <h2>{title}</h2>
  <slot />
</article>

<style>
  .card { padding: 1rem; }
  @media (max-width: 600px) {
    .card { padding: 0.5rem; }
  }
</style>

<script>
  console.log("card mounted");
</script>
`;

describe("buildComponentModel", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cm-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds the template tree with kinds, spans, and locs", async () => {
    const model = await buildComponentModel(tmpDir, "src/components/Card.astro");
    expect(model.path).toBe("src/components/Card.astro");
    expect(model.version).toMatch(/^(sha256:[0-9a-f]{12}|[0-9a-f]{40})$/);

    expect(model.template.kind).toBe("fragment");
    const article = model.template.children[0];
    expect(article.kind).toBe("element");
    expect(article.tag).toBe("article");
    expect(article.attrs).toEqual([{ name: "class", value: "card" }]);
    expect(article.span[0]).toBeGreaterThan(0);
    expect(article.loc?.line).toBeGreaterThan(0);

    const [h2, slot] = article.children;
    expect(h2.tag).toBe("h2");
    expect(h2.children[0].kind).toBe("expression");
    expect(slot.kind).toBe("slot");

    // ids unique across the tree
    const ids = new Set<string>();
    const visit = (n: { id: string; children: { id: string }[] }) => {
      expect(ids.has(n.id)).toBe(false);
      ids.add(n.id);
      (n.children as any[]).forEach(visit);
    };
    visit(model.template as any);
  });

  it("classifies component instances", async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "Page.astro"),
      `<div>\n  <Card title="hi" />\n</div>\n`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/Page.astro");
    const card = model.template.children[0].children[0];
    expect(card.kind).toBe("component");
    expect(card.tag).toBe("Card");
    expect(card.attrs).toEqual([{ name: "title", value: "hi" }]);
  });

  it("rejects traversal and non-astro paths", async () => {
    await expect(buildComponentModel(tmpDir, "../etc/passwd")).rejects.toMatchObject({
      reason: "invalid-input",
    });
    await expect(buildComponentModel(tmpDir, "src/components/Card.css")).rejects.toMatchObject({
      reason: "invalid-input",
    });
  });

  it("reports read failures", async () => {
    await expect(buildComponentModel(tmpDir, "src/components/Missing.astro")).rejects.toMatchObject({
      reason: "read-failed",
    });
  });

  it("extracts style rules with media context and file-absolute spans", async () => {
    const model = await buildComponentModel(tmpDir, "src/components/Card.astro");
    expect(model.styles).toHaveLength(2);

    const [plain, mobile] = model.styles;
    expect(plain.selector).toBe(".card");
    expect(plain.media).toBeNull();
    expect(plain.declarations).toEqual([
      expect.objectContaining({ property: "padding", value: "1rem" }),
    ]);

    expect(mobile.selector).toBe(".card");
    expect(mobile.media).toContain("max-width");
    expect(mobile.declarations[0].value).toBe("0.5rem");

    // file-absolute span: the source slice at the declaration span mentions the property
    const [s, e] = plain.declarations[0].span;
    expect(CARD.slice(s, e)).toContain("padding");
  });

  it("extracts frontmatter with a parsed Props interface", async () => {
    const model = await buildComponentModel(tmpDir, "src/components/Card.astro");
    expect(model.frontmatter?.source).toContain("interface Props");
    expect(model.frontmatter?.props).toEqual([
      { name: "title", type: "string", optional: false, default: null },
      { name: "count", type: "number", optional: true, default: "1" },
    ]);
  });

  it("extracts the client script zone", async () => {
    const model = await buildComponentModel(tmpDir, "src/components/Card.astro");
    expect(model.clientScript?.source).toContain("card mounted");
    const [s, e] = model.clientScript!.span;
    expect(CARD.slice(s!, e!)).toContain("card mounted");
  });

  it("returns null zones and empty props when absent", async () => {
    writeFileSync(join(tmpDir, "src", "components", "Bare.astro"), `<p>hello</p>\n`);
    const model = await buildComponentModel(tmpDir, "src/components/Bare.astro");
    expect(model.frontmatter).toBeNull();
    expect(model.clientScript).toBeNull();
    expect(model.styles).toEqual([]);
  });
});
