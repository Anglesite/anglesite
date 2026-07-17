import { describe, it, expect } from "vitest";
import { parse } from "@astrojs/compiler";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";

const CARD = `---
interface Props { title: string; }
---
<article class="card" data-size="lg">
  <h2>{title}</h2>
  <Badge label="new" />
</article>
`;

describe("buildTemplateNodeIndex", () => {
  it("assigns the synthetic root id n0, then depth-first ids to real nodes", async () => {
    const { ast } = await parse(CARD, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, CARD);
    expect(rootId).toBe("n0");
    const root = byId.get("n0");
    expect(root.kind).toBe("fragment");
    expect(root.parentId).toBeNull();
    expect(root.childIds).toHaveLength(1); // <article>

    const article = byId.get(root.childIds[0]);
    expect(article.kind).toBe("element");
    expect(article.tag).toBe("article");
    expect(article.parentId).toBe("n0");
  });

  it("also returns astById, mapping each node id to its raw compiler AST node", async () => {
    const source = `---\n---\n<div title={foo}><h2>Hi</h2></div>\n`;
    const { ast } = await parse(source, { position: true });
    const { byId, rootId, astById } = buildTemplateNodeIndex(ast, source);
    const div = byId.get(byId.get(rootId).childIds[0]);
    const astNode = astById.get(div.id);
    expect(astNode.type).toBe("element");
    expect(astNode.name).toBe("div");
    expect(astNode.attributes.find((a) => a.name === "title").kind).toBe("expression");
  });

  it("captures attribute name/value/span", async () => {
    const { ast } = await parse(CARD, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const classAttr = article.attrs.find((a) => a.name === "class");
    expect(classAttr.value).toBe("card");
    expect(CARD.slice(classAttr.span[0], classAttr.span[1])).toBe('class="card"');
  });

  it("classifies a capitalized tag as kind=component and indexes it as a child", async () => {
    const { ast } = await parse(CARD, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const badgeId = article.childIds.find((id) => byId.get(id).kind === "component");
    expect(byId.get(badgeId).tag).toBe("Badge");
    expect(byId.get(badgeId).parentId).toBe(article.id);
  });

  it("gives the same ids across two independent parses of identical source (determinism)", async () => {
    const { ast: ast1 } = await parse(CARD, { position: true });
    const { ast: ast2 } = await parse(CARD, { position: true });
    const idx1 = buildTemplateNodeIndex(ast1, CARD);
    const idx2 = buildTemplateNodeIndex(ast2, CARD);
    expect([...idx1.byId.keys()]).toEqual([...idx2.byId.keys()]);
  });

  it("skips style/script zones and filters non-JSX text out of expression children", async () => {
    const src = `---\n---\n<div>{items.map((i) => (<li>{i}</li>))}</div>\n<style>.x{color:red;}</style>\n<script>console.log(1)</script>\n`;
    const { ast } = await parse(src, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, src);
    const div = byId.get(byId.get(rootId).childIds[0]);
    expect(div.tag).toBe("div");
    const expr = byId.get(div.childIds[0]);
    expect(expr.kind).toBe("expression");
    const li = byId.get(expr.childIds[0]);
    expect(li.tag).toBe("li");
    // style/script never appear as template children anywhere in the tree.
    for (const rec of byId.values()) {
      expect(rec.kind).not.toBe("style");
      expect(rec.kind).not.toBe("script");
    }
  });

  // @astrojs/compiler@4.0.0 reports `position.*.offset` as a UTF-8 byte offset, not a
  // JS-string (UTF-16) index. Any multi-byte-UTF-8 character earlier in the source
  // (astral-plane emoji, but also plain accented/CJK characters) used to corrupt the
  // span of every node that followed it. These regressions assert every node's span
  // slices back to itself regardless of what precedes it in the source.
  describe("Unicode-safe spans", () => {
    function assertAllSpansSelfConsistent(byId, src) {
      for (const rec of byId.values()) {
        if (rec.span[0] == null || rec.span[1] == null) continue;
        const slice = src.slice(rec.span[0], rec.span[1]);
        if (rec.kind === "text") {
          expect(slice).toContain(rec.text.length < 80 ? rec.text : rec.text.slice(0, 10));
        } else if (rec.tag) {
          expect(slice.startsWith(`<${rec.tag}`)).toBe(true);
        }
      }
    }

    it("keeps element spans correct when an emoji precedes them in a text node", async () => {
      const src = `---\n---\n<div>\u{1F389} emoji before <p>Body</p><span>Keep</span></div>\n`;
      const { ast } = await parse(src, { position: true });
      const { byId, rootId } = buildTemplateNodeIndex(ast, src);
      const div = byId.get(byId.get(rootId).childIds[0]);
      const [text, p, span] = div.childIds.map((id) => byId.get(id));
      expect(src.slice(...text.span)).toContain("emoji before");
      expect(src.slice(...p.span)).toBe("<p>Body</p>");
      expect(src.slice(...span.span)).toBe("<span>Keep</span>");
      assertAllSpansSelfConsistent(byId, src);
    });

    it("keeps attribute-value spans correct when the value itself contains an emoji", async () => {
      const src = `---\n---\n<div data-x="\u{1F389}"><p>Body</p><span>Keep</span></div>\n`;
      const { ast } = await parse(src, { position: true });
      const { byId, rootId } = buildTemplateNodeIndex(ast, src);
      const div = byId.get(byId.get(rootId).childIds[0]);
      const attr = div.attrs.find((a) => a.name === "data-x");
      expect(src.slice(...attr.span)).toBe('data-x="\u{1F389}"');
      const [p, span] = div.childIds.map((id) => byId.get(id));
      expect(src.slice(...p.span)).toBe("<p>Body</p>");
      expect(src.slice(...span.span)).toBe("<span>Keep</span>");
      assertAllSpansSelfConsistent(byId, src);
    });

    it("keeps spans correct with multiple emoji inside nested elements", async () => {
      const src = `---\n---\n<section>\u{1F389}\u{1F680}<article><h1>\u{2764}Title</h1><p>Body \u{1F600} text</p></article></section>\n`;
      const { ast } = await parse(src, { position: true });
      const { byId, rootId } = buildTemplateNodeIndex(ast, src);
      const section = byId.get(byId.get(rootId).childIds[0]);
      const article = section.childIds.map((id) => byId.get(id)).find((n) => n.tag === "article");
      const [h1, p] = article.childIds.map((id) => byId.get(id));
      expect(src.slice(...h1.span)).toBe("<h1>\u{2764}Title</h1>");
      expect(src.slice(...p.span)).toBe("<p>Body \u{1F600} text</p>");
      assertAllSpansSelfConsistent(byId, src);
    });

    it("keeps element spans correct when a plain (BMP) accented/CJK character precedes them", async () => {
      const src = `---\n---\n<div>café 你好 before <p>Body</p></div>\n`;
      const { ast } = await parse(src, { position: true });
      const { byId, rootId } = buildTemplateNodeIndex(ast, src);
      const div = byId.get(byId.get(rootId).childIds[0]);
      const p = byId.get(div.childIds[1]);
      expect(src.slice(...p.span)).toBe("<p>Body</p>");
      assertAllSpansSelfConsistent(byId, src);
    });
  });
});
