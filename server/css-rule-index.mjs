import { parse as parseCss, generate, walk } from "css-tree";

/**
 * Span-precise CSS rule index for one <style> element. Shared by the
 * read-only component model (component-model.mjs) and the write-side
 * resolver (component-style-edit.mjs) so both agree byte-for-byte on rule
 * identity — selector text alone is not reliable (css-tree's generate()
 * re-serializes and can normalize whitespace/quoting away from the source).
 */
export function indexCssRules(styleElement) {
  const lang = (styleElement.attributes ?? []).find((a) => a.name === "lang")?.value;
  if (lang && lang.trim().toLowerCase() !== "css") return []; // scss/less etc.: css-tree error-recovery emits garbage rows
  const textChild = (styleElement.children ?? []).find((c) => c.type === "text");
  if (!textChild?.value) return [];
  const baseOffset = textChild.position?.start?.offset ?? 0;

  let cssAst;
  try {
    cssAst = parseCss(textChild.value, { positions: true, parseValue: false, parseAtrulePrelude: false });
  } catch {
    return []; // unparseable CSS: styles stay empty; template/props still usable
  }

  const rules = [];
  walk(cssAst, {
    visit: "Rule",
    enter(node) {
      const media =
        this.atrule && this.atrule.name === "media" && this.atrule.prelude
          ? generate(this.atrule.prelude).trim()
          : null;
      const declarations = [];
      node.block.children.forEach((decl) => {
        if (decl.type !== "Declaration") return;
        declarations.push({
          property: decl.property,
          value: generate(decl.value).trim(),
          span: span(decl.loc, baseOffset),
        });
      });
      const blockSpan = span(node.block.loc, baseOffset);
      rules.push({
        selector: generate(node.prelude),
        preludeSpan: span(node.prelude.loc, baseOffset),
        media,
        span: span(node.loc, baseOffset),
        blockInner: [blockSpan[0] + 1, blockSpan[1] - 1],
        declarations,
      });
    },
  });
  return rules;
}

function span(loc, baseOffset) {
  if (!loc) return [null, null];
  return [baseOffset + loc.start.offset, baseOffset + loc.end.offset];
}
