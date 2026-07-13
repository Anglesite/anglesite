import { readFileSync } from "node:fs";
import { join, normalize, dirname, relative } from "node:path";
import { parse } from "@astrojs/compiler";
import { fileVersion } from "./file-version.mjs";
import { buildTemplateNodeIndex } from "./component-node-index.mjs";
import { ensureImport, pruneImportIfUnused } from "./frontmatter-imports.mjs";

function refuse(reason, detail) {
  return { refused: true, reason, detail };
}

// Matches escapeAttr in create-content.mjs: escape "&" first (so it doesn't
// double-escape the entities this introduces), then escape '"' so the value
// can't break out of the double-quoted attribute it's interpolated into.
function escapeAttr(s) {
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
class SpanResolutionError extends Error {
  constructor(nodeId) {
    super(`could not lexically locate node ${nodeId}`);
    this.nodeId = nodeId;
  }
}

// HTML void elements: never have a closing tag, self-closing or not — same terminal
// handling as an explicit self-closing tag (<img />). https://html.spec.whatwg.org/#void-elements
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Reconstructs correct byte spans for every element/component/slot/fragment/expression
// node in `byId` in one full depth-first walk, in lockstep with a monotonically
// advancing cursor through `source` (see the file-level comment above for why this
// replaces the old per-node k-th-occurrence search). Returns a Map<nodeId, [start, end]>
// (only for kinds this function can resolve — text nodes and tagless fragments are
// never spanned); throws `SpanResolutionError` if a node's marker can't be located.
function resolveAllSpans(byId, rootId, source) {
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

function collectComponentTags(byId, nodeId) {
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
