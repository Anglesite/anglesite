import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { parse } from "@astrojs/compiler";
import { fileVersion } from "./file-version.mjs";
import { indexCssRules } from "./css-rule-index.mjs";
import { buildLineStarts } from "./component-node-index.mjs";

/**
 * Write-side resolver for the four Component Editor style ops
 * (set-style-property, remove-style-property, set-rule-selector,
 * add-style-rule). Re-indexes the target .astro file's <style> block(s)
 * fresh from disk via `indexCssRules` (Task 2) and turns the requested op
 * into a precise byte-range splice — the same `{file, range, replacement}`
 * shape every other resolver in `patcher.mjs` produces.
 */

function refuse(reason, detail) {
  return { refused: true, reason, detail };
}

export async function resolveComponentStyle(projectRoot, edit) {
  const { component } = edit;
  if (!component || typeof component !== "object") {
    return refuse("invalid-input", "component payload is required for this op");
  }
  const { path: relPath, baseVersion, ruleSpan, property, value, selector, media, declarations } = component;

  if (typeof relPath !== "string" || !relPath.endsWith(".astro") || normalize(relPath).startsWith("..") || relPath.startsWith("/")) {
    return refuse("invalid-input", `not a project-relative .astro path: ${relPath}`);
  }

  const absPath = join(projectRoot, relPath);
  let source;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch (err) {
    return refuse("read-failed", `read ${relPath}: ${err.message}`);
  }

  if (fileVersion(source) !== baseVersion) {
    return refuse("stale", `${relPath} changed since the model was fetched`);
  }

  let ast;
  try {
    ({ ast } = await parse(source, { position: true }));
  } catch (err) {
    return refuse("parse-failed", `parse ${relPath}: ${err.message}`);
  }

  const lineStarts = buildLineStarts(source);
  const styleElements = [];
  collectStyleElements(ast, styleElements);
  const rules = styleElements.flatMap((el) => indexCssRules(el, lineStarts));

  switch (edit.op) {
    case "set-style-property":
      return applySetStyleProperty(relPath, rules, ruleSpan, property, value);
    case "remove-style-property":
      return applyRemoveStyleProperty(relPath, source, rules, ruleSpan, property);
    case "set-rule-selector":
      return applySetRuleSelector(relPath, rules, ruleSpan, selector);
    case "add-style-rule":
      return applyAddStyleRule(relPath, source, styleElements, selector, media, declarations);
    default:
      return refuse("invalid-input", `unsupported component-style op: ${edit.op}`);
  }
}

function collectStyleElements(node, out) {
  if (node.type === "element" && node.name === "style") out.push(node);
  for (const child of node.children ?? []) collectStyleElements(child, out);
}

function findRule(rules, ruleSpan) {
  if (!Array.isArray(ruleSpan) || ruleSpan.length !== 2) return undefined;
  return rules.find((r) => r.span[0] === ruleSpan[0] && r.span[1] === ruleSpan[1]);
}

function applySetStyleProperty(file, rules, ruleSpan, property, value) {
  if (typeof property !== "string" || typeof value !== "string") {
    return refuse("invalid-input", "set-style-property requires component.property and component.value");
  }
  const rule = findRule(rules, ruleSpan);
  if (!rule) return refuse("no-match", "no rule found at the given span — the file may have changed");

  const existing = rule.declarations.find((d) => d.property === property);
  if (existing) {
    return { file, range: { start: existing.span[0], end: existing.span[1] }, replacement: `${property}: ${value}` };
  }
  const insertAt = rule.blockInner[1];
  return { file, range: { start: insertAt, end: insertAt }, replacement: `\n  ${property}: ${value};` };
}

function applyRemoveStyleProperty(file, source, rules, ruleSpan, property) {
  if (typeof property !== "string") {
    return refuse("invalid-input", "remove-style-property requires component.property");
  }
  const rule = findRule(rules, ruleSpan);
  if (!rule) return refuse("no-match", "no rule found at the given span — the file may have changed");

  const decl = rule.declarations.find((d) => d.property === property);
  if (!decl) return refuse("no-match", `no declaration for property "${property}" on this rule`);

  // Extend the end past a trailing separator: consume one ";" if present
  // (the last declaration in a block has no trailing ";", so don't eat "}").
  let end = decl.span[1];
  while (end < source.length && source[end] !== ";" && source[end] !== "}") end++;
  if (source[end] === ";") end++;

  // Trim leading horizontal whitespace back to (but not past) a preceding
  // newline, then also swallow that one newline so removing a declaration
  // doesn't leave a blank line behind. Only trims a single line's worth of
  // indentation — a rule's block is always indented on its own line in the
  // sources this resolver targets.
  let start = decl.span[0];
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  if (start > 0 && source[start - 1] === "\n") start--;

  return { file, range: { start, end }, replacement: "" };
}

function applySetRuleSelector(file, rules, ruleSpan, selector) {
  if (typeof selector !== "string" || selector.trim() === "") {
    return refuse("invalid-input", "set-rule-selector requires a non-empty component.selector");
  }
  const rule = findRule(rules, ruleSpan);
  if (!rule) return refuse("no-match", "no rule found at the given span — the file may have changed");

  return { file, range: { start: rule.preludeSpan[0], end: rule.preludeSpan[1] }, replacement: selector };
}

function applyAddStyleRule(file, source, styleElements, selector, media, declarations) {
  if (typeof selector !== "string" || selector.trim() === "") {
    return refuse("invalid-input", "add-style-rule requires a non-empty component.selector");
  }
  const decls = Array.isArray(declarations) ? declarations : [];
  const body = decls.map((d) => `  ${d.property}: ${d.value};`).join("\n");
  const rule = media
    ? `@media ${media} {\n  ${selector} {\n${body ? body.split("\n").map((l) => "  " + l).join("\n") + "\n" : ""}  }\n}`
    : `${selector} {\n${body ? body + "\n" : ""}}`;

  const lastStyle = styleElements[styleElements.length - 1];
  if (!lastStyle) {
    return { file, range: { start: source.length, end: source.length }, replacement: `\n<style>\n${rule}\n</style>\n` };
  }
  const insertAt = styleInsertionPoint(lastStyle, source);
  return { file, range: { start: insertAt, end: insertAt }, replacement: `\n\n${rule}` };
}

/**
 * Where to splice a new rule into an existing <style> element: right before
 * its closing tag. Normally that's the text child's end offset — but a
 * genuinely empty `<style></style>` has no text child at all, and
 * `lastStyle.position.end.offset` is the offset *after* `</style>`, not
 * before it. Falling back to that would splice the new rule outside the
 * style element (rendered as literal page text, not CSS). Instead, derive
 * the pre-closing-tag offset from the closing tag's own length, verified
 * against the source so a malformed/unexpected shape still degrades to the
 * (safe, if imprecise) end-of-element offset rather than guessing wrong.
 */
function styleInsertionPoint(styleEl, source) {
  const textChild = (styleEl.children ?? []).find((c) => c.type === "text");
  if (textChild?.position?.end?.offset != null) return textChild.position.end.offset;
  const closeTag = `</${styleEl.name}>`;
  const candidate = styleEl.position.end.offset - closeTag.length;
  if (source.slice(candidate, styleEl.position.end.offset) === closeTag) return candidate;
  return styleEl.position.end.offset;
}
