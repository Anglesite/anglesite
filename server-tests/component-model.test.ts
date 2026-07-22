import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
    expect(model.version).toMatch(/^sha256:[0-9a-f]{12}$/);

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

  it("version tracks file content, not repo state", async () => {
    const before = await buildComponentModel(tmpDir, "src/components/Card.astro");
    writeFileSync(
      join(tmpDir, "src", "components", "Card.astro"),
      CARD.replace("card mounted", "card remounted"),
    );
    const after = await buildComponentModel(tmpDir, "src/components/Card.astro");
    expect(before.version).not.toBe(after.version);

    // Same content → same version, regardless of when it's computed.
    const again = await buildComponentModel(tmpDir, "src/components/Card.astro");
    expect(again.version).toBe(after.version);
  });

  it("captures comma-containing default values intact", async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "List.astro"),
      `---
interface Props {
  items: string[];
  label?: string;
  point?: object;
  count?: number;
}
const { items = ["a", "b"], label = "hello, world", point = { x: 1, y: 2 }, count = 2 } = Astro.props;
---
<ul></ul>
`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/List.astro");
    expect(model.frontmatter?.props).toEqual([
      { name: "items", type: "string[]", optional: false, default: '["a", "b"]' },
      { name: "label", type: "string", optional: true, default: '"hello, world"' },
      { name: "point", type: "object", optional: true, default: "{ x: 1, y: 2 }" },
      { name: "count", type: "number", optional: true, default: "2" },
    ]);
  });

  it("leaves defaults null for malformed (mid-edit) destructures instead of assigning garbage", async () => {
    // Unbalanced bracket, as the live Component Editor will see mid-keystroke:
    // the naive part would be `["a", "b", label = "fallback"` — silently wrong.
    writeFileSync(
      join(tmpDir, "src", "components", "Broken.astro"),
      `---
interface Props {
  items: string[];
  label?: string;
}
const { items = ["a", "b", label = "fallback" } = Astro.props;
---
<ul></ul>
`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/Broken.astro");
    expect(model.frontmatter?.props).toEqual([
      { name: "items", type: "string[]", optional: false, default: null },
      { name: "label", type: "string", optional: true, default: null },
    ]);
  });

  it("passes <Fragment> through with its children instead of dropping the subtree", async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "Frag.astro"),
      `<Fragment slot="header">\n  <p>one</p>\n  <p>two</p>\n</Fragment>\n`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/Frag.astro");
    const frag = model.template.children[0];
    expect(frag.kind).toBe("fragment");
    expect(frag.attrs).toEqual([{ name: "slot", value: "header" }]);
    const tags = frag.children.map((c: { tag: string }) => c.tag);
    expect(tags).toEqual(["p", "p"]);
  });

  it("skips non-CSS style blocks instead of emitting error-recovery garbage", async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "Scss.astro"),
      `<div class="a">hi</div>
<style lang="scss">
  $x: 1;
  .a { color: red; }
</style>
<style>
  .b { color: blue; }
</style>
`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/Scss.astro");
    expect(model.styles).toHaveLength(1);
    expect(model.styles[0].selector).toBe(".b");
  });

  it('treats lang=" css " (stray whitespace) as plain CSS', async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "LangWs.astro"),
      `<div>hi</div>\n<style lang=" css ">\n  .a { color: red; }\n</style>\n`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/LangWs.astro");
    expect(model.styles).toHaveLength(1);
    expect(model.styles[0].selector).toBe(".a");
  });

  it("still extracts rules from is:global style blocks (plain CSS)", async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "Global.astro"),
      `<div>hi</div>\n<style is:global>\n  body { margin: 0; }\n</style>\n`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/Global.astro");
    expect(model.styles).toHaveLength(1);
    expect(model.styles[0].selector).toBe("body");
  });

  it("walks JSX embedded in a top-level conditional expression instead of dropping it", async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "Hcard.astro"),
      `---
const profile = { name: "x" };
---
{profile && (
  <footer class="site-identity">
    <div class="h-card">
      <p class="p-name">{profile.name}</p>
    </div>
  </footer>
)}
`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/Hcard.astro");
    const expr = model.template.children[0];
    expect(expr.kind).toBe("expression");
    expect(expr.children).toHaveLength(1);

    const footer = expr.children[0];
    expect(footer.kind).toBe("element");
    expect(footer.tag).toBe("footer");
    const div = footer.children[0];
    expect(div.tag).toBe("div");
    const p = div.children[0];
    expect(p.tag).toBe("p");
    // The inline `{profile.name}` expression stays a childless leaf — its
    // "children" are JS source (an identifier chain), not markup.
    expect(p.children[0].kind).toBe("expression");
    expect(p.children[0].children).toEqual([]);
  });

  it("filters style/script zones at any depth while still extracting them", async () => {
    writeFileSync(
      join(tmpDir, "src", "components", "Nested.astro"),
      `<div>
  <style>
    .deep { color: red; }
  </style>
  <script>
    console.log("deep script");
  </script>
  <p>content</p>
</div>
`,
    );
    const model = await buildComponentModel(tmpDir, "src/components/Nested.astro");
    const div = model.template.children[0];
    // No style/script nodes anywhere in the template tree...
    const tags: string[] = [];
    const visit = (n: { tag: string | null; children: any[] }) => {
      if (n.tag) tags.push(n.tag);
      n.children.forEach(visit);
    };
    visit(model.template as any);
    expect(tags).toEqual(["div", "p"]);
    expect(div.children).toHaveLength(1);
    // ...but the zones are still extracted.
    expect(model.styles).toHaveLength(1);
    expect(model.styles[0].selector).toBe(".deep");
    expect(model.clientScript?.source).toContain("deep script");
  });

  // @astrojs/compiler@4.0.0 reports `position.*.offset` as a UTF-8 byte offset, not a
  // JS-string (UTF-16) index — an emoji or other multi-byte-UTF-8 character anywhere
  // earlier in the source used to corrupt template/frontmatter/clientScript spans for
  // everything that followed it.
  describe("Unicode-safe spans end to end", () => {
    it("keeps template node spans correct when an emoji precedes them in the template", async () => {
      writeFileSync(
        join(tmpDir, "src", "components", "Emoji.astro"),
        `---\n---\n<div>\u{1F389} emoji before <p>Body</p><span>Keep</span></div>\n`,
      );
      const model = await buildComponentModel(tmpDir, "src/components/Emoji.astro");
      const source = readFileSync(join(tmpDir, "src", "components", "Emoji.astro"), "utf-8");
      const div = model.template.children[0];
      const [, p, span] = div.children;
      expect(source.slice(...(p.span as [number, number]))).toBe("<p>Body</p>");
      expect(source.slice(...(span.span as [number, number]))).toBe("<span>Keep</span>");
    });

    it("keeps frontmatter and clientScript spans correct when the template (which comes first in source order for clientScript) contains an emoji", async () => {
      const src = `---\ninterface Props { title: string; }\n---\n<div>\u{1F389} hi</div>\n<script>\n  console.log("after emoji");\n</script>\n`;
      writeFileSync(join(tmpDir, "src", "components", "EmojiScript.astro"), src);
      const model = await buildComponentModel(tmpDir, "src/components/EmojiScript.astro");

      const [fs, fe] = model.frontmatter!.span as [number, number];
      expect(src.slice(fs, fe)).toBe('---\ninterface Props { title: string; }\n---');

      const [ss, se] = model.clientScript!.span as [number, number];
      expect(src.slice(ss, se)).toContain('console.log("after emoji")');
    });

    it("keeps CSS rule/declaration spans correct when an emoji precedes the <style> element", async () => {
      const src = `---\n---\n<div>\u{1F389} emoji before</div>\n<style>\n  .card { padding: 1rem; }\n</style>\n`;
      writeFileSync(join(tmpDir, "src", "components", "EmojiStyle.astro"), src);
      const model = await buildComponentModel(tmpDir, "src/components/EmojiStyle.astro");

      expect(model.styles).toHaveLength(1);
      const [rule] = model.styles;
      expect(src.slice(...(rule.span as [number, number]))).toBe(".card { padding: 1rem; }");
      const [ds, de] = rule.declarations[0].span as [number, number];
      expect(src.slice(ds, de)).toBe("padding: 1rem");
    });
  });
});
