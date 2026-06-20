/**
 * Pure scoped-<style> rewriter for the `edit-style` op.
 *
 * Component-encapsulation model: a style change lands in the owning .astro file's scoped
 * <style> block (created if absent), targeting the element via its existing #id or .class.
 * When the element has neither, a deterministic marker class (ang-<6 hex>) is added to its
 * opening tag and used as the selector.
 *
 * Returns { next, selectorUsed, addedMarkerClass? } or { refused, reason, detail }.
 */
import { createHash } from "node:crypto";

function refuse(reason, detail) {
  return { refused: true, reason, detail };
}

/**
 * Locate the element's opening tag in `source`.
 * Returns {start, end, tagText} on success,
 * {ambiguous: true} when multiple candidates exist but no text anchor resolves them,
 * or null when no candidate found.
 */
function findOpeningTag(source, selector) {
  const tag = selector.tag?.toLowerCase();
  if (!tag) return null;
  // Prefer locating by the element's static text content (same heuristic the text resolver uses).
  const re = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let m;
  const tags = [];
  while ((m = re.exec(source)) !== null) {
    tags.push({ start: m.index, end: m.index + m[0].length, tagText: m[0] });
  }
  if (tags.length === 0) return null;
  if (selector.textContent) {
    // pick the tag immediately preceding the textContent occurrence
    const idx = source.indexOf(selector.textContent);
    if (idx !== -1) {
      const owning = tags.filter((t) => t.end <= idx).sort((a, b) => b.end - a.end)[0];
      if (owning) return owning;
    }
  }
  if (tags.length === 1) return tags[0];
  // Multiple candidates but no usable text anchor — signal ambiguity to the caller.
  return { ambiguous: true };
}

/** Derive the CSS selector for the element, mutating the tag to add a marker class if needed. */
function deriveSelector(tagText, selector) {
  if (selector.id) return { selectorUsed: `#${selector.id}`, newTagText: tagText };
  if (selector.classes && selector.classes.length > 0) {
    return { selectorUsed: `.${selector.classes[0]}`, newTagText: tagText };
  }
  // No id/class: synthesize a deterministic marker class from tag + textContent.
  const seed = `${selector.tag}|${selector.textContent ?? ""}|${selector.nthChild ?? 0}`;
  const marker = "ang-" + createHash("sha1").update(seed).digest("hex").slice(0, 6);
  // inject class="..." before the closing > (handle self-closing and existing attrs)
  const newTagText = tagText.replace(/(\s*\/?>)$/, ` class="${marker}"$1`);
  return { selectorUsed: `.${marker}`, addedMarkerClass: marker, newTagText };
}

/** Insert/merge `property: value` for `selectorUsed` in the file's scoped <style> block.
 *
 * A scoped rule must NOT land in a block marked is:global or is:inline.
 * Logic:
 *   1. Find ALL <style …>…</style> blocks.
 *   2. Pick the first whose opening tag has neither is:global nor is:inline.
 *   3. If found, merge into it (preserving its exact opening tag).
 *   4. If none found (only global/inline blocks, or no blocks at all), append a fresh
 *      scoped <style> block — do NOT modify any global/inline block.
 */
function upsertStyleRule(source, selectorUsed, property, value) {
  const decl = `${property}: ${value};`;

  // Collect all <style …>…</style> occurrences.
  const styleRe = /(<style\b[^>]*>)([\s\S]*?)<\/style>/gi;
  let m;
  let scopedMatch = null;
  while ((m = styleRe.exec(source)) !== null) {
    const openTag = m[1];
    // Skip global or inline blocks.
    if (/\bis:global\b/.test(openTag) || /\bis:inline\b/.test(openTag)) continue;
    scopedMatch = { full: m[0], openTag, css: m[2], index: m.index };
    break;
  }

  if (!scopedMatch) {
    // No scoped <style> block — append one at end of file.
    const block = `\n<style>\n  ${selectorUsed} { ${decl} }\n</style>\n`;
    return source.replace(/\s*$/, "") + block + "\n";
  }

  const { full, openTag, css, index } = scopedMatch;
  const ruleRe = new RegExp(`(${escapeRegex(selectorUsed)}\\s*\\{)([^}]*)(\\})`);
  const rm = css.match(ruleRe);
  let newCss;
  if (rm) {
    // Strip any existing declaration for the same property before merging.
    // Word-boundary-ish check: require the char before the property name to be start, `;`, or
    // whitespace so that `color` doesn't incorrectly strip `background-color`.
    const propRe = new RegExp(
      `(^|;)(\\s*)(?<![\\w-])${escapeRegex(property)}\\s*:[^;]*;?`,
      "gi",
    );
    const bodyStripped = rm[2].replace(propRe, "$1$2").trim();
    const merged = bodyStripped.length ? `${bodyStripped} ${decl}` : decl;
    newCss = css.replace(ruleRe, `$1 ${merged} $3`);
  } else {
    newCss = `${css.replace(/\s*$/, "")}\n  ${selectorUsed} { ${decl} }\n`;
  }

  const newBlock = `${openTag}${newCss}</style>`;
  return source.slice(0, index) + newBlock + source.slice(index + full.length);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rewriteAstroStyle(source, selector, property, value) {
  const tag = findOpeningTag(source, selector);
  if (!tag) return refuse("no-match", `could not locate <${selector.tag}> for style edit`);
  if (tag.ambiguous) return refuse("ambiguous", `multiple <${selector.tag}> candidates with no usable text anchor`);
  const { selectorUsed, addedMarkerClass, newTagText } = deriveSelector(tag.tagText, selector);
  let next = source;
  if (newTagText !== tag.tagText) {
    next = source.slice(0, tag.start) + newTagText + source.slice(tag.end);
  }
  next = upsertStyleRule(next, selectorUsed, property, value);
  const result = { next, selectorUsed };
  if (addedMarkerClass) result.addedMarkerClass = addedMarkerClass;
  return result;
}
