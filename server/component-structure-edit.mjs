import { readFileSync } from "node:fs";
import { join, normalize, dirname, relative, sep } from "node:path";
import { parse } from "@astrojs/compiler";
import { fileVersion } from "./file-version.mjs";
import { buildTemplateNodeIndex } from "./component-node-index.mjs";
import { ensureImport, pruneImportIfUnused } from "./frontmatter-imports.mjs";

// `resolveAllSpans`/`SpanResolutionError`/`VOID_ELEMENTS`/`escapeAttr`/`importSpecifier`/
// `collectComponentTags` are exported (in addition to being used locally) so
// component-extract-edit.mjs — which needs the exact same "never trust node.span directly for a
// node's own boundary" span-resolution discipline to locate the extracted subtree, the same
// attribute-escaping and relative-import-specifier helpers `insert-node`'s component-import case
// uses, and the same component-tag walk `remove-node` uses for import pruning (extract-component
// uses it the other direction: carrying imports for component-kind descendants INTO the new
// file) — can reuse this module's single, carefully-tested implementation rather than a second,
// drift-prone copy.

function refuse(reason, detail) {
  return { refused: true, reason, detail };
}

// Matches escapeAttr in create-content.mjs: escape "&" first (so it doesn't
// double-escape the entities this introduces), then escape '"' so the value
// can't break out of the double-quoted attribute it's interpolated into.
export function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function validPath(relPath) {
  return typeof relPath === "string" && relPath.endsWith(".astro") && !normalize(relPath).startsWith("..") && !relPath.startsWith("/");
}

async function loadFresh(projectRoot, relPath, baseVersion) {
  const absPath = join(projectRoot, relPath);
  let source;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch (err) {
    return { error: refuse("read-failed", `read ${relPath}: ${err.message}`) };
  }
  if (fileVersion(source) !== baseVersion) {
    return { error: refuse("stale", `${relPath} changed since the model was fetched`) };
  }
  let ast;
  try {
    ({ ast } = await parse(source, { position: true }));
  } catch (err) {
    return { error: refuse("parse-failed", `parse ${relPath}: ${err.message}`) };
  }
  const { byId, rootId } = buildTemplateNodeIndex(ast, source);
  return { source, ast, byId, rootId };
}

export async function resolveComponentStructure(projectRoot, edit) {
  const { component } = edit;
  if (!component || typeof component !== "object") {
    return refuse("invalid-input", "component payload is required for this op");
  }
  const { path: relPath, baseVersion } = component;
  if (!validPath(relPath)) {
    return refuse("invalid-input", `not a project-relative .astro path: ${relPath}`);
  }

  const loaded = await loadFresh(projectRoot, relPath, baseVersion);
  if (loaded.error) return loaded.error;
  const { source, byId, rootId } = loaded;

  switch (edit.op) {
    case "set-attr":
      return applySetAttr(relPath, source, byId, component);
    case "remove-node":
      return applyRemoveNode(relPath, source, byId, rootId, component);
    case "insert-node":
      return applyInsertNode(relPath, source, byId, rootId, component);
    case "move-node":
      return applyMoveNode(relPath, source, byId, rootId, component);
    default:
      return refuse("invalid-input", `unsupported component-structure op: ${edit.op}`);
  }
}

function applySetAttr(file, source, byId, component) {
  const { nodeId, name, value } = component;
  if (typeof nodeId !== "string" || typeof name !== "string") {
    return refuse("invalid-input", "set-attr requires component.nodeId and component.name");
  }
  const node = byId.get(nodeId);
  if (!node || node.span[0] == null || node.span[1] == null) {
    return refuse("no-match", "no node found at the given id — the file may have changed");
  }
  // Only element/component/slot nodes are tag-shaped (`<tag ...>`); text and shorthand
  // fragments have no attribute list to search or insert into, and expression nodes'
  // spans are unreliable even via line/column (see resolveAllSpans' file-level comment).
  // Trusting node.span/node.attrs for any other kind would splice attribute syntax into
  // running text or an unreliable expression span instead of refusing.
  if (node.kind !== "element" && node.kind !== "component" && node.kind !== "slot") {
    return refuse("invalid-input", `set-attr requires a tag-shaped node (element/component/slot), got kind=${node.kind}`);
  }
  const existing = node.attrs.find((a) => a.name === name);

  if (value === null || value === undefined) {
    if (!existing) return refuse("no-match", `node has no attribute "${name}" to remove`);
    // Mirrors applyRemoveStyleProperty in component-style-edit.mjs: trim leading horizontal
    // whitespace back to (but not past) a preceding newline, then also swallow that one
    // newline, so removing an attribute on a one-per-line-formatted tag doesn't leave a
    // blank/trailing-whitespace line behind. On a single-line tag this just trims back to
    // the previous token (tag name or prior attribute), same as before.
    let start = existing.span[0];
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    if (start > 0 && source[start - 1] === "\n") start--;
    return { file, range: { start, end: existing.span[1] }, replacement: "" };
  }

  if (existing) {
    return { file, range: { start: existing.span[0], end: existing.span[1] }, replacement: `${name}="${escapeAttr(value)}"` };
  }
  // Insert right after the opening tag name / last attribute — i.e. at the end of the node's
  // own attribute list. `node.span[0]` is the start of `<tag`; the tag-name end is the offset
  // right before the first attribute (or before `>`/`/>` if there are none). Reuse the last
  // attribute's end when present; otherwise fall back to just after the tag name.
  const lastAttr = node.attrs[node.attrs.length - 1];
  const insertAt = lastAttr ? lastAttr.span[1] : node.span[0] + 1 + (node.tag?.length ?? 0);
  return { file, range: { start: insertAt, end: insertAt }, replacement: ` ${name}="${escapeAttr(value)}"` };
}

// @astrojs/compiler (4.0.0) reports CORRUPTED source positions for ANY node kind —
// element/component/fragment/slot as well as "expression" — whenever astral-plane
// Unicode (e.g. an emoji) appears anywhere in the source BEFORE that node. The
// corruption is not a fixed/predictable delta, so `position.start/end.offset` cannot be
// trusted, patched, or scanned-forward-from for ANY node kind. Root-causing the
// compiler's offset math is out of scope here; instead, remove-node NEVER consults
// `node.span`/`position.offset` to locate a removal boundary.
//
// A first fix (see git history) re-derived each node's span by finding the k-th
// DOCUMENT-WIDE occurrence of its `(kind, tag)` marker, where k was the node's ordinal
// among its TRUE parent's children. That broke whenever an EARLIER sibling contained a
// nested descendant of the same `(kind, tag)` — e.g. `<div><div>Inner</div></div>
// <div>Target</div>`: removing the second top-level `<div>` instead silently removed
// "Inner", because document-wide occurrence counting doesn't respect nesting depth (the
// 2nd `<div>` textually is nested one level inside the FIRST top-level div, not a
// sibling of "Target" at all). Same bug for expressions.
//
// `resolveAllSpans` replaces that ordinal search with a monotonic-cursor parallel walk:
// it walks `byId` in the SAME depth-first order the AST was built in (that order is
// already correct — @astrojs/compiler gets tree STRUCTURE right; only its byte OFFSETS
// are corrupted), advancing a single cursor through `source` in lockstep. The cursor
// only ever moves forward and always fully consumes a node's entire extent (including
// all its descendants) before searching for the NEXT sibling, so a later sibling's
// search can never accidentally match something nested inside an earlier sibling — by
// the time that search runs, the cursor has already passed the entire earlier subtree.
// No occurrence counting is needed at all: each sibling is simply "the next occurrence
// of this marker from here."
//
// Searches run over `maskOpaqueZones(source)` (frontmatter/`<style>`/`<script>`/HTML
// comments blanked to same-length spaces) so stray `<`, `>`, `{`, `}` in those
// regions — none of which are represented in `byId` — can't produce false matches;
// spans returned still index into the real `source` (masking preserves length/offsets),
// and blanking the frontmatter also means the cursor can simply start at 0.
//
// LIMITATIONS (a deliberate, documented simplification — not a general HTML/JSX parser;
// remove-node refuses with "no-match" (via `SpanResolutionError`) rather than guessing
// when the walk can't find a node's marker, so failure is safe even where these limits
// are hit):
//   - An expression's own nested JSX children (e.g. the `<li>{i}</li>` inside
//     `{items.map((i) => (<li>{i}</li>))}`) are consumed as part of the outer
//     expression's span (matching the existing "remove as a single opaque unit"
//     requirement) — their own spans are still resolved (for reusability by future
//     callers like move-node) but bounded to fall strictly inside the outer expression.
//   - Shorthand `<>...</>` fragments (kind "fragment" with no tag name — true of both
//     the synthetic document root and any real `<>...</>` in the template) have no
//     lexical tag to search for and are refused outright, as is "text" kind (which is
//     also never spanned — a text node's `.text` is a truncated preview, not reliably
//     re-locatable, and nothing needs its exact span).

function maskOpaqueZones(source) {
  const maskRange = (str, start, end) => str.slice(0, start) + " ".repeat(end - start) + str.slice(end);
  let masked = source;
  const fm = source.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (fm) masked = maskRange(masked, fm.index, fm.index + fm[0].length);
  masked = masked.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => " ".repeat(m.length));
  masked = masked.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  return masked;
}

function isWordChar(ch) {
  return !!ch && /[a-zA-Z0-9:_.-]/.test(ch);
}

function skipQuoted(s, pos, quoteChar) {
  let j = pos + 1;
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2;
      continue;
    }
    if (s[j] === quoteChar) return j + 1;
    j++;
  }
  return s.length;
}

// End (exclusive) of the brace-delimited block starting at `start` (s[start] === "{"),
// honoring nested braces and quoted/template-literal strings. Returns -1 if unterminated.
function scanBraceBlock(s, start) {
  let depth = 0;
  let j = start;
  while (j < s.length) {
    const ch = s[j];
    if (ch === '"' || ch === "'" || ch === "`") {
      j = skipQuoted(s, j, ch);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return -1;
}

// End (exclusive) of a tag's own opening `<...>` starting at `start` (s[start] === "<"),
// honoring quoted attribute values and brace-delimited attribute expressions so a stray
// `>` inside either doesn't prematurely close the tag. Returns null if unterminated.
function scanTagOpen(s, start) {
  let j = start + 1;
  while (j < s.length) {
    const ch = s[j];
    if (ch === '"' || ch === "'" || ch === "`") {
      j = skipQuoted(s, j, ch);
      continue;
    }
    if (ch === "{") {
      const end = scanBraceBlock(s, j);
      if (end === -1) return null;
      j = end;
      continue;
    }
    if (ch === ">") return { end: j + 1, selfClosing: s[j - 1] === "/" };
    j++;
  }
  return null;
}

// If `s[i]` starts a tag (open or close), returns { closing, name, afterName }; else null.
function readTagOpenerAt(s, i) {
  if (s[i] !== "<") return null;
  const closing = s[i + 1] === "/";
  const nameStart = closing ? i + 2 : i + 1;
  let j = nameStart;
  while (isWordChar(s[j])) j++;
  const name = s.slice(nameStart, j);
  if (!name) return null;
  return { closing, name, afterName: j };
}

// From just after a non-self-closing open tag's `<tagName ...>`, scans forward
// depth-counting nested same-name tags to find the true matching `</tagName>`. Returns
// the offset just past that close tag, or -1 if unterminated.
function findMatchingClose(masked, tagName, from) {
  let depth = 1;
  let i = from;
  const n = masked.length;
  while (i < n) {
    const opener = readTagOpenerAt(masked, i);
    if (!opener) {
      i++;
      continue;
    }
    if (opener.name !== tagName) {
      if (opener.closing) {
        const gt = masked.indexOf(">", opener.afterName);
        i = gt === -1 ? n : gt + 1;
      } else {
        const tagInfo = scanTagOpen(masked, i);
        if (!tagInfo) return -1;
        i = tagInfo.end;
      }
      continue;
    }
    if (opener.closing) {
      depth--;
      const gt = masked.indexOf(">", opener.afterName);
      const closeEnd = gt === -1 ? n : gt + 1;
      if (depth === 0) return closeEnd;
      i = closeEnd;
    } else {
      const tagInfo = scanTagOpen(masked, i);
      if (!tagInfo) return -1;
      if (!tagInfo.selfClosing) depth++;
      i = tagInfo.end;
    }
  }
  return -1;
}

// Forward search from `from` for the next OPEN `<tagName ...>` (or self-closing
// `<tagName ... />`) occurrence in `masked` — i.e. "the next occurrence of this marker
// from here," not a k-th-occurrence count. Skips over any other tag (open or close)
// encountered along the way, respecting quoted attribute values and brace-delimited
// attribute expressions (via `scanTagOpen`) so a stray `<`/`>` inside either can't
// terminate the skip early. Returns the index of the opening `<`, or -1 if not found.
function findTagOpenFrom(masked, tagName, from) {
  let i = from;
  const n = masked.length;
  while (i < n) {
    const opener = readTagOpenerAt(masked, i);
    if (!opener) {
      i++;
      continue;
    }
    if (opener.closing) {
      const gt = masked.indexOf(">", opener.afterName);
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    if (opener.name === tagName) return i;
    const tagInfo = scanTagOpen(masked, i);
    if (!tagInfo) return -1;
    i = tagInfo.end;
  }
  return -1;
}

// Thrown by `resolveAllSpans` when a node's lexical marker can't be found from the
// current cursor position. Callers must catch this and refuse the op (fail closed)
// rather than guess — see the file-level comment above for why offsets can't be trusted.
export class SpanResolutionError extends Error {
  constructor(nodeId) {
    super(`could not lexically locate node ${nodeId}`);
    this.nodeId = nodeId;
  }
}

// HTML void elements: never have a closing tag, self-closing or not — same terminal
// handling as an explicit self-closing tag (<img />). https://html.spec.whatwg.org/#void-elements
export const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Reconstructs correct byte spans for every element/component/slot/fragment/expression
// node in `byId` in one full depth-first walk, in lockstep with a monotonically
// advancing cursor through `source` (see the file-level comment above for why this
// replaces the old per-node k-th-occurrence search). Returns a Map<nodeId, [start, end]>
// (only for kinds this function can resolve — text nodes and tagless fragments are
// never spanned); throws `SpanResolutionError` if a node's marker can't be located.
export function resolveAllSpans(byId, rootId, source) {
  const masked = maskOpaqueZones(source);
  const spans = new Map();
  let cursor = 0;

  function consumeChildren(childIds, boundEnd) {
    for (const childId of childIds) consume(childId, boundEnd);
  }

  // `boundEnd`, when non-null, is the exclusive upper bound a node's own marker must be
  // found before — used to keep an expression's nested JSX children from resolving past
  // that expression's own closing brace.
  function consume(nodeId, boundEnd) {
    const node = byId.get(nodeId);
    if (!node || node.kind === "text") return; // no span needed; cursor untouched

    if (node.kind === "expression") {
      const openIdx = masked.indexOf("{", cursor);
      if (openIdx === -1 || (boundEnd != null && openIdx >= boundEnd)) throw new SpanResolutionError(nodeId);
      const closeEnd = scanBraceBlock(masked, openIdx); // exclusive end, one past the matching "}"
      if (closeEnd === -1) throw new SpanResolutionError(nodeId);
      spans.set(nodeId, [openIdx, closeEnd]);
      cursor = openIdx + 1;
      consumeChildren(node.childIds, closeEnd - 1);
      cursor = closeEnd;
      return;
    }

    // element / component / slot / fragment — all tag-shaped, keyed by node.tag. A
    // shorthand `<>...</>` fragment (kind "fragment" with no tag name, true of both the
    // synthetic document root and any real `<>...</>` in the template) has no lexical
    // marker to search for — refuse rather than guess.
    if (!node.tag) throw new SpanResolutionError(nodeId);
    const openIdx = findTagOpenFrom(masked, node.tag, cursor);
    if (openIdx === -1 || (boundEnd != null && openIdx >= boundEnd)) throw new SpanResolutionError(nodeId);
    const tagInfo = scanTagOpen(masked, openIdx);
    if (!tagInfo) throw new SpanResolutionError(nodeId);
    // Void elements (<img>, <br>, etc.) never have a closing tag — treat them as
    // terminal at their own opening tag's end, same as an explicit self-closing tag,
    // regardless of what the model reports for childIds. Checked before the close-tag
    // search below so a bare `<img src="x">` never triggers a `</img>` lookup.
    if (tagInfo.selfClosing || VOID_ELEMENTS.has(node.tag)) {
      spans.set(nodeId, [openIdx, tagInfo.end]);
      cursor = tagInfo.end;
      return;
    }
    if (node.childIds.length === 0) {
      // Childless in the model (no element/component/expression/non-blank-text child)
      // but not self-closing — e.g. `<p></p>` or `<div>   </div>`. Still has a real
      // close tag; find it directly from just past the open tag.
      const closeEnd = findMatchingClose(masked, node.tag, tagInfo.end);
      if (closeEnd === -1) throw new SpanResolutionError(nodeId);
      spans.set(nodeId, [openIdx, closeEnd]);
      cursor = closeEnd;
      return;
    }
    cursor = tagInfo.end;
    consumeChildren(node.childIds, null);
    const closeEnd = findMatchingClose(masked, node.tag, cursor);
    if (closeEnd === -1) throw new SpanResolutionError(nodeId);
    spans.set(nodeId, [openIdx, closeEnd]);
    cursor = closeEnd;
  }

  consumeChildren(byId.get(rootId).childIds, null);
  return spans;
}

function applyRemoveNode(file, source, byId, rootId, component) {
  const { nodeId } = component;
  if (typeof nodeId !== "string") {
    return refuse("invalid-input", "remove-node requires component.nodeId");
  }
  const node = byId.get(nodeId);
  if (!node) return refuse("no-match", "no node found at the given id — the file may have changed");
  if (node.parentId === null) return refuse("invalid-input", "cannot remove the component's root");

  let spans;
  try {
    spans = resolveAllSpans(byId, rootId, source);
  } catch (err) {
    if (!(err instanceof SpanResolutionError)) throw err;
    return refuse(
      "no-match",
      "could not lexically re-locate the node's true source span without trusting compiler offsets — refusing rather than risking corruption"
    );
  }
  const span = spans.get(nodeId);
  if (!span) {
    return refuse(
      "no-match",
      "could not lexically re-locate the node's true source span without trusting compiler offsets — refusing rather than risking corruption"
    );
  }

  // Trim a single leading run of horizontal whitespace back to (but not past) a preceding
  // newline, then swallow that newline too — mirrors remove-style-property's cleanup so
  // removing a node doesn't leave a blank line in its place.
  let start = span[0];
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  if (start > 0 && source[start - 1] === "\n") start--;

  const withoutNode = source.slice(0, start) + source.slice(span[1]);

  // Prune now-unused component imports. Only meaningful for `component`-kind nodes (and any
  // component-kind descendants the removed subtree also carried away); walk the removed
  // subtree collecting component tag names, then check each against the frontmatter's import
  // list against the POST-removal template text.
  const removedComponentNames = collectComponentTags(byId, nodeId);
  if (removedComponentNames.length === 0) {
    return { file, range: { start: 0, end: source.length }, replacement: withoutNode };
  }

  const fmMatch = withoutNode.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) {
    return { file, range: { start: 0, end: source.length }, replacement: withoutNode };
  }
  const [whole, open, fmBody, close] = fmMatch;
  const fmStart = fmMatch.index;
  const fmBodyStart = fmStart + open.length;
  let newFmBody = fmBody;
  for (const name of removedComponentNames) {
    newFmBody = pruneImportIfUnused(newFmBody, withoutNode.slice(fmStart + whole.length), name).source;
  }
  const rewritten = withoutNode.slice(0, fmBodyStart) + newFmBody + withoutNode.slice(fmBodyStart + fmBody.length);
  return { file, range: { start: 0, end: source.length }, replacement: rewritten };
}

export function collectComponentTags(byId, nodeId) {
  const names = [];
  function walk(id) {
    const n = byId.get(id);
    if (!n) return;
    if (n.kind === "component" && n.tag) names.push(n.tag);
    for (const c of n.childIds) walk(c);
  }
  walk(nodeId);
  return names;
}

function buildMarkup(nodeSpec) {
  if (nodeSpec.kind === "slot") {
    return nodeSpec.slotName ? `<slot name="${escapeAttr(nodeSpec.slotName)}" />` : `<slot />`;
  }
  if (nodeSpec.kind === "component") {
    return `<${nodeSpec.tag} />`;
  }
  return `<${nodeSpec.tag}></${nodeSpec.tag}>`;
}

/** Relative import specifier from the target component's own directory to the component
 *  being inserted, Astro-style (keeps the .astro extension, always POSIX-separated, always
 *  prefixed with ./ or ../ so it never gets mistaken for a bare-specifier package import). */
export function importSpecifier(targetRelPath, componentRelPath) {
  const rel = relative(dirname(targetRelPath), componentRelPath).split(sep).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

// Offset just inside `parent`'s content when it currently has no (resolvable) children to
// anchor on — i.e. "right after the opening tag" for a real element/component/slot, or
// "end of file" for the synthetic fragment root (which has no lexical open/close tag of
// its own to anchor on). Returns null when a safe insertion point can't be determined
// (parent's own span wasn't resolved, or it turns out to be self-closing/void and
// therefore has no content region to insert into at all).
function childlessInsertionPoint(parent, rootId, spans, source) {
  if (parent.id === rootId) return source.length;
  const parentSpan = spans.get(parent.id);
  if (!parentSpan) return null;
  const wholeText = source.slice(parentSpan[0], parentSpan[1]);
  if (wholeText.endsWith("/>") || VOID_ELEMENTS.has(parent.tag)) return null; // no closing tag to insert before
  const closeTag = `</${parent.tag}>`;
  const candidate = parentSpan[1] - closeTag.length;
  return source.slice(candidate, parentSpan[1]) === closeTag ? candidate : parentSpan[1];
}

// Resolves the character offset in `source` at which to insert new content as a child of
// `parent` at position `index` (clamped to the child count). Shared by insert-node (new
// content, nothing excluded) and move-node (destination side; excludes the node being
// moved from the sibling list, since it may already be a child of `parent` when reordering
// in place).
//
// Picks the nearest RESOLVABLE sibling as its anchor, since text-kind children (and any
// node `resolveAllSpans` couldn't resolve) have no entry in `spans`:
//   - Appending (clampedIndex === children.length): the nearest resolvable sibling
//     searching BACKWARD from the end, anchored at its span END.
//   - Inserting before children[clampedIndex]: the nearest resolvable sibling searching
//     FORWARD from that index, anchored at its span START (so the new node lands
//     immediately before it); if none found forward, falls back to searching BACKWARD for
//     the nearest resolvable PRECEDING sibling's span END instead. If no child in the list
//     is resolvable at all, falls back to the childless-parent case.
//
// Returns null when no insertion point could be resolved.
function resolveInsertionOffset(byId, rootId, spans, source, parent, index, excludeChildId) {
  const children = parent.childIds.filter((id) => id !== excludeChildId).map((id) => byId.get(id));
  if (children.length === 0) {
    return childlessInsertionPoint(parent, rootId, spans, source);
  }
  const clampedIndex = Math.max(0, Math.min(index, children.length));
  let insertAt = null;
  if (clampedIndex === children.length) {
    for (let i = children.length - 1; i >= 0 && insertAt == null; i--) {
      const span = spans.get(children[i].id);
      if (span) insertAt = span[1];
    }
  } else {
    for (let i = clampedIndex; i < children.length && insertAt == null; i++) {
      const span = spans.get(children[i].id);
      if (span) insertAt = span[0];
    }
    if (insertAt == null) {
      for (let i = clampedIndex - 1; i >= 0 && insertAt == null; i--) {
        const span = spans.get(children[i].id);
        if (span) insertAt = span[1];
      }
    }
  }
  if (insertAt == null) {
    insertAt = childlessInsertionPoint(parent, rootId, spans, source);
  }
  return insertAt;
}

function applyInsertNode(file, source, byId, rootId, component) {
  const { parentId, index, node: nodeSpec } = component;
  if (typeof parentId !== "string" || typeof index !== "number" || !nodeSpec || typeof nodeSpec !== "object") {
    return refuse("invalid-input", "insert-node requires component.parentId, component.index, and component.node");
  }
  if (!["element", "component", "slot"].includes(nodeSpec.kind)) {
    return refuse("invalid-input", `unsupported node.kind: ${nodeSpec.kind}`);
  }
  if ((nodeSpec.kind === "element" || nodeSpec.kind === "component") && typeof nodeSpec.tag !== "string") {
    return refuse("invalid-input", "node.tag is required for element/component inserts");
  }
  if (nodeSpec.kind === "component" && typeof nodeSpec.componentPath !== "string") {
    return refuse("invalid-input", "node.componentPath is required for component inserts");
  }

  const parent = byId.get(parentId);
  if (!parent) return refuse("no-match", "no parent node found at the given id — the file may have changed");
  if (parent.kind === "text") {
    return refuse("invalid-input", "cannot insert into a text node — it has no children");
  }

  // Same discipline as remove-node: NEVER trust `node.span`/`position.offset` straight off
  // `byId` (unreliable for expression-kind nodes, and historically for others too — see
  // the file-level comment above `resolveAllSpans`). Every insertion offset below is
  // derived exclusively from the `spans` Map this returns.
  let spans;
  try {
    spans = resolveAllSpans(byId, rootId, source);
  } catch (err) {
    if (!(err instanceof SpanResolutionError)) throw err;
    return refuse(
      "no-match",
      "could not lexically re-locate the parent's true source span without trusting compiler offsets — refusing rather than risking corruption"
    );
  }

  const insertAt = resolveInsertionOffset(byId, rootId, spans, source, parent, index, undefined);
  if (insertAt == null) {
    return refuse("no-match", "could not resolve an insertion point for the given parent/index");
  }

  const markup = buildMarkup(nodeSpec);
  const withNode = source.slice(0, insertAt) + markup + source.slice(insertAt);

  if (nodeSpec.kind !== "component") {
    return { file, range: { start: 0, end: source.length }, replacement: withNode };
  }

  // Component insert: also add (or reuse) its default import in the frontmatter.
  const fmMatch = withNode.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) {
    // No frontmatter at all yet — synthesize one carrying just the import.
    const importLine = `import ${nodeSpec.tag} from "${importSpecifier(file, nodeSpec.componentPath)}";\n`;
    return { file, range: { start: 0, end: source.length }, replacement: `---\n${importLine}---\n${withNode}` };
  }
  const [, open, fmBody] = fmMatch;
  const fmBodyStart = fmMatch.index + open.length;
  const { source: newFmBody } = ensureImport(fmBody, { localName: nodeSpec.tag, specifier: importSpecifier(file, nodeSpec.componentPath) });
  const rewritten = withNode.slice(0, fmBodyStart) + newFmBody + withNode.slice(fmBodyStart + fmBody.length);
  return { file, range: { start: 0, end: source.length }, replacement: rewritten };
}

// True if `nodeId` is a descendant of `ancestorId`, walking `byId`'s `parentId` chain
// upward from `nodeId`. Used to refuse move-node when the requested destination sits
// inside the subtree of the node being moved (which would otherwise create a cycle).
function isDescendant(byId, ancestorId, nodeId) {
  const node = byId.get(nodeId);
  let cur = node?.parentId ?? null;
  while (cur !== null) {
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

// move-node is an in-source remove-then-reinsert against a single mutable string, done in
// ONE splice against the ORIGINAL (pre-removal) source rather than two sequential edits.
// Both the node's own span and the destination insertion offset are resolved from the same
// `resolveAllSpans` call, over the SAME unmutated `source` — exactly like remove-node and
// insert-node resolve their spans/offsets, and for the same reason (never trust
// `node.span`/`position.offset` straight off `byId`, see the file-level comment above
// `resolveAllSpans`).
//
// Because both offsets are resolved against the original string, removing the node's old
// text shifts every offset that came after it — including, potentially, the destination
// insertion offset. Rather than computing that shift as a separate correction pass, the
// splice below picks one of two mutually exclusive orderings directly from the ORIGINAL
// offsets:
//   - insertAt <= removeStart: the destination is at or before the node's own (trimmed)
//     removal start, so the removal happens entirely AFTER the insertion point in the
//     original string — insert first, then everything from the insertion point up to
//     removeStart carries over unshifted, and the removed range is simply dropped.
//   - insertAt >= removeEnd: the destination is at or after the node's own removal end, so
//     the removal happens entirely BEFORE the insertion point — the removed range is
//     dropped first, then everything from removeEnd up to the insertion point carries over
//     unshifted, followed by the moved node's text, then the remainder.
// A destination offset strictly BETWEEN removeStart and removeEnd would mean landing inside
// the very span being removed; the ancestor check earlier already rules out the structural
// case that would cause this (moving into your own subtree), but it's guarded again below
// as a fail-closed check rather than assumed.
function applyMoveNode(file, source, byId, rootId, component) {
  const { nodeId, newParentId, newIndex } = component;
  if (typeof nodeId !== "string" || typeof newParentId !== "string" || typeof newIndex !== "number") {
    return refuse("invalid-input", "move-node requires component.nodeId, component.newParentId, and component.newIndex");
  }
  const node = byId.get(nodeId);
  const newParent = byId.get(newParentId);
  if (!node || !newParent) return refuse("no-match", "nodeId or newParentId not found — the file may have changed");
  if (node.parentId === null) return refuse("invalid-input", "cannot move the component's root");
  if (newParent.kind === "text") {
    return refuse("invalid-input", "cannot move a node into a text node — it has no children");
  }
  if (nodeId === newParentId || isDescendant(byId, nodeId, newParentId)) {
    return refuse("invalid-input", "cannot move a node into its own subtree");
  }

  let spans;
  try {
    spans = resolveAllSpans(byId, rootId, source);
  } catch (err) {
    if (!(err instanceof SpanResolutionError)) throw err;
    return refuse(
      "no-match",
      "could not lexically re-locate the node's true source span without trusting compiler offsets — refusing rather than risking corruption"
    );
  }
  const nodeSpan = spans.get(nodeId);
  if (!nodeSpan) {
    return refuse(
      "no-match",
      "could not lexically re-locate the node's true source span without trusting compiler offsets — refusing rather than risking corruption"
    );
  }

  // Resolve the destination offset on the ORIGINAL source, excluding the moving node from
  // `newParent`'s own children list (it may already be one of them, when reordering siblings
  // in place — see the file-level comment above `resolveInsertionOffset`).
  const insertAt = resolveInsertionOffset(byId, rootId, spans, source, newParent, newIndex, nodeId);
  if (insertAt == null) {
    return refuse("no-match", "could not resolve an insertion point for the given newParentId/newIndex");
  }

  const nodeText = source.slice(nodeSpan[0], nodeSpan[1]);

  // Same whitespace/newline cleanup remove-node uses at the node's old location: trim a
  // leading run of horizontal whitespace back to (but not past) a preceding newline, then
  // swallow that newline too, so the old location doesn't leave a blank line behind.
  let removeStart = nodeSpan[0];
  while (removeStart > 0 && (source[removeStart - 1] === " " || source[removeStart - 1] === "\t")) removeStart--;
  if (removeStart > 0 && source[removeStart - 1] === "\n") removeStart--;
  const removeEnd = nodeSpan[1];

  if (insertAt > removeStart && insertAt < removeEnd) {
    return refuse("invalid-input", "insertion point falls inside the node's own span being moved");
  }

  const rewritten =
    insertAt <= removeStart
      ? source.slice(0, insertAt) + nodeText + source.slice(insertAt, removeStart) + source.slice(removeEnd)
      : source.slice(0, removeStart) + source.slice(removeEnd, insertAt) + nodeText + source.slice(insertAt);

  return { file, range: { start: 0, end: source.length }, replacement: rewritten };
}
