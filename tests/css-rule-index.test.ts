import { describe, it, expect } from "vitest";
import { parse } from "@astrojs/compiler";
import { indexCssRules } from "../server/css-rule-index.mjs";

const SOURCE = `<style>
  .card { padding: 1rem; color: red; }
  @media (max-width: 600px) {
    .card { padding: 0.5rem; }
  }
</style>
`;

async function styleElement() {
  const { ast } = await parse(SOURCE, { position: true });
  return ast.children.find((n: any) => n.type === "element" && n.name === "style");
}

describe("indexCssRules", () => {
  it("captures selector, media, span, preludeSpan, blockInner, and declarations", async () => {
    const el = await styleElement();
    const rules = indexCssRules(el);
    expect(rules).toHaveLength(2);

    const [card, media] = rules;
    expect(card.selector).toBe(".card");
    expect(card.media).toBeNull();
    expect(SOURCE.slice(card.preludeSpan[0], card.preludeSpan[1])).toBe(".card");
    expect(SOURCE.slice(card.span[0], card.span[1])).toContain("padding: 1rem");
    expect(card.declarations).toEqual([
      { property: "padding", value: "1rem", span: card.declarations[0].span },
      { property: "color", value: "red", span: card.declarations[1].span },
    ]);
    expect(SOURCE.slice(card.declarations[0].span[0], card.declarations[0].span[1])).toBe("padding: 1rem");
    // blockInner sits strictly inside the braces
    expect(SOURCE[card.blockInner[0] - 1]).toBe("{");
    expect(SOURCE[card.blockInner[1]]).toBe("}");

    expect(media.media).toBe("(max-width: 600px)");
    expect(media.selector).toBe(".card");
  });

  it("returns [] for a non-CSS lang attribute", async () => {
    const src = `<style lang="scss">.x { &:hover { color: blue; } }</style>`;
    const { ast } = await parse(src, { position: true });
    const el = ast.children.find((n: any) => n.type === "element" && n.name === "style");
    expect(indexCssRules(el)).toEqual([]);
  });
});
