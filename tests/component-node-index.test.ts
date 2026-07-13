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
});
