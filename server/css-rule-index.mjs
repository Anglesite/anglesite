import { parse as parseCss, generate, walk } from "css-tree";
import { offsetFromLineColumn } from "./component-node-index.mjs";

/**
 * Span-precise CSS rule index for one <style> element. Shared by the
 * read-only component model (component-model.mjs) and the write-side
 * resolver (component-style-edit.mjs) so both agree byte-for-byte on rule
 * identity — selector text alone is not reliable (css-tree's generate()
 * re-serializes and can normalize whitespace/quoting away from the source).
 *
 * `lineStarts` (from component-node-index.mjs's `buildLineStarts(source)`) is
 * required, not optional: @astrojs/compiler@4.0.0 reports `position.*.offset`
 * as a UTF-8 byte offset, not a JS-string (UTF-16) index, so it can't be used
 * directly as `baseOffset` — any multi-byte-UTF-8 character earlier in the
 * source (emoji, accented Latin, CJK, etc.) would silently corrupt every rule
 * and declaration span this function returns. `.line`/`.column` are reliable
 * in UTF-16 terms, so `baseOffset` is derived from those instead — the same
 * approach component-node-index.mjs and component-model.mjs already use for
 * template/frontmatter/clientScript spans.
 */
export function indexCssRules(styleElement, lineStarts) {
  const lang = (styleElement.attributes ?? []).find((a) => a.name === "lang")?.value;
  if (lang && lang.trim().toLowerCase() !== "css") return []; // scss/less etc.: css-tree error-recovery emits garbage rows
  const textChild = (styleElement.children ?? []).find((c) => c.type === "text");
  if (!textChild?.value) return [];
  const baseOffset = offsetFromLineColumn(lineStarts, textChild.position?.start) ?? 0;

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
