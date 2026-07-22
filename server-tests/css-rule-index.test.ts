import { describe, it, expect } from "vitest";
import { parse } from "@astrojs/compiler";
import { indexCssRules } from "../server/css-rule-index.mjs";
import { buildLineStarts } from "../server/component-node-index.mjs";

const SOURCE = `<style>
  .card { padding: 1rem; color: red; }
  @media (max-width: 600px) {
    .card { padding: 0.5rem; }
  }
</style>
`;

async function styleElement(src: string = SOURCE) {
  const { ast } = await parse(src, { position: true });
  return ast.children.find((n: any) => n.type === "element" && n.name === "style");
}

describe("indexCssRules", () => {
  it("captures selector, media, span, preludeSpan, blockInner, and declarations", async () => {
    const el = await styleElement();
    const rules = indexCssRules(el, buildLineStarts(SOURCE));
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
    expect(indexCssRules(el, buildLineStarts(src))).toEqual([]);
  });

  // @astrojs/compiler@4.0.0 reports `position.*.offset` as a UTF-8 byte offset, not a
  // JS-string (UTF-16) index — an emoji or other multi-byte-UTF-8 character earlier in
  // the source used to corrupt every span this module returns (see the analogous fix in
  // component-node-index.mjs's buildLineStarts/offsetFromLineColumn).
  it("keeps spans correct when an emoji precedes the <style> element", async () => {
    const src = `<div>\u{1F389} emoji</div>\n<style>\n  .card { padding: 1rem; }\n</style>\n`;
    const el = await styleElement(src);
    const [rule] = indexCssRules(el, buildLineStarts(src));
    expect(src.slice(rule.span[0], rule.span[1])).toBe(".card { padding: 1rem; }");
    expect(src.slice(rule.declarations[0].span[0], rule.declarations[0].span[1])).toBe("padding: 1rem");
  });
});
