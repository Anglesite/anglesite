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
  const { source, byId } = loaded;

  switch (edit.op) {
    case "set-attr":
      return applySetAttr(relPath, source, byId, component);
    case "remove-node":
      return applyRemoveNode(relPath, source, byId, component);
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
// corruption is not a fixed/predictable delta, so `position.start/end.offset` cannot
// be trusted, patched, or scanned-forward-from for ANY node kind (an earlier version of
// this file only patched expression-kind nodes by scanning forward from the reported
// offset for the next literal "{" — that can land on the WRONG node entirely under this
// bug, silently deleting an unrelated sibling). Root-causing the compiler's offset math
// is out of scope here; instead, remove-node NEVER consults `node.span`/`position.offset`
// to locate a removal boundary. It re-derives the node's true span purely lexically from
// `source`, anchored by the node's ordinal position among same-(kind,tag) siblings under
// its parent — `byId`'s parent/child SHAPE (not its offsets) is unaffected by the bug,
// since it comes from the AST tree structure, not from position numbers.
//
// Two lexical scanners do the actual span-finding, operating on `source` with
// frontmatter/`<style>`/`<script>`/HTML-comment zones blanked out (`maskOpaqueZones`) so
// stray `<`, `>`, `{`, `}` in those regions can't produce false matches:
//   - findNthExpressionBlock: the k-th top-level `{...}` block in *text* position
//     (i.e. not inside a tag's own attribute list — `<div class={x}>`'s `{x}` doesn't
//     count) anywhere in the source.
//   - findNthTagSpan: the k-th `<tagName ...>...</tagName>` (or self-closing
//     `<tagName ... />`) occurrence of a given tag name anywhere in the source, with its
//     true matching close resolved via depth-counting over nested same-name tags.
//
// Both scan the WHOLE source rather than a "search window" bounded by the parent's own
// span — the parent's span may ALSO be corrupted, so it can't be trusted as a bound
// either. The sibling-ordinal anchor (not a tight window) is what disambiguates.
//
// LIMITATIONS (a deliberate, documented simplification — not a general HTML/JSX parser;
// remove-node refuses with "no-match" rather than guessing when these scanners can't
// find a confident k-th occurrence, so failure is safe even where these limits are hit):
//   - The ordinal count spans the WHOLE document in source order, not just the target's
//     immediate siblings. A node nested *inside* an earlier same-tag sibling (e.g.
//     `<div><div/></div><div/>`, removing the second top-level div) can shift the count
//     and misidentify the target. Not exercised by any fixture in this repo today.
//   - findNthExpressionBlock only counts *top-level* `{...}` blocks: an expression nested
//     inside another expression's JSX children is consumed as part of the outer block's
//     span (matching the existing "remove as a single opaque unit" requirement), so it
//     can't separately target such a nested node — but buildTemplateNodeIndex doesn't
//     index those as separate nodes anyway (JSX_CHILD_TYPES excludes "expression").
//   - Shorthand `<>...</>` fragments (kind "fragment" with no tag name) have no lexical
//     tag to search for and are refused outright, as are any other unhandled node kinds
//     (e.g. "text") — this fix only covers "expression" and "element"/"component"/
//     "slot"/"fragment-with-a-tag" removal, matching the reported bug's scope.

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

// The k-th (0-based) top-level `{...}` block in text position anywhere in `masked`.
function findNthExpressionBlock(masked, k) {
  let count = 0;
  let i = 0;
  const n = masked.length;
  while (i < n) {
    const ch = masked[i];
    if (ch === "<") {
      const opener = readTagOpenerAt(masked, i);
      if (opener) {
        if (opener.closing) {
          const gt = masked.indexOf(">", opener.afterName);
          i = gt === -1 ? n : gt + 1;
          continue;
        }
        const tagInfo = scanTagOpen(masked, i);
        if (tagInfo) {
          i = tagInfo.end;
          continue;
        }
      }
    }
    if (ch === "{") {
      const end = scanBraceBlock(masked, i);
      if (end === -1) {
        i++;
        continue;
      }
      if (count === k) return [i, end];
      count++;
      i = end;
      continue;
    }
    i++;
  }
  return null;
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

// The k-th (0-based) occurrence of an open tag named `tagName` anywhere in `masked`
// (self-closing or not), with its true matching close.
function findNthTagSpan(masked, tagName, k) {
  let count = 0;
  let i = 0;
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
    const tagInfo = scanTagOpen(masked, i);
    if (!tagInfo) return null;
    if (opener.name === tagName) {
      if (count === k) {
        if (tagInfo.selfClosing) return [i, tagInfo.end];
        const closeEnd = findMatchingClose(masked, tagName, tagInfo.end);
        return closeEnd === -1 ? null : [i, closeEnd];
      }
      count++;
    }
    i = tagInfo.end;
  }
  return null;
}

// Establishes the node's 0-based ordinal `k` among its parent's children that share the
// same (kind, tag) grouping (expression nodes group by kind alone — tag is always null).
function siblingOrdinal(byId, node) {
  const parent = byId.get(node.parentId);
  if (!parent) return null;
  const sameGroup = parent.childIds
    .map((id) => byId.get(id))
    .filter((n) => n && (node.kind === "expression" ? n.kind === "expression" : n.kind === node.kind && n.tag === node.tag));
  const k = sameGroup.findIndex((n) => n.id === node.id);
  return k === -1 ? null : k;
}

function findTrueSpan(byId, node, source) {
  const k = siblingOrdinal(byId, node);
  if (k === null) return null;
  const masked = maskOpaqueZones(source);
  if (node.kind === "expression") return findNthExpressionBlock(masked, k);
  if ((node.kind === "element" || node.kind === "component" || node.kind === "slot" || node.kind === "fragment") && node.tag) {
    return findNthTagSpan(masked, node.tag, k);
  }
  return null; // unhandled kind (e.g. "text", tagless fragment) — caller refuses
}

// Defends against a scanner returning a span that doesn't actually start with the
// marker we searched for — belt-and-suspenders on top of the ordinal anchor.
function spanLooksSane(source, node, span) {
  if (!span) return false;
  const [start, end] = span;
  if (start == null || end == null || end <= start || end > source.length) return false;
  if (node.kind === "expression") {
    return source[start] === "{" && source[end - 1] === "}";
  }
  const prefix = `<${node.tag}`;
  if (source.slice(start, start + prefix.length) !== prefix) return false;
  const afterPrefixChar = source[start + prefix.length];
  return afterPrefixChar === undefined || /[\s/>]/.test(afterPrefixChar);
}

function applyRemoveNode(file, source, byId, component) {
  const { nodeId } = component;
  if (typeof nodeId !== "string") {
    return refuse("invalid-input", "remove-node requires component.nodeId");
  }
  const node = byId.get(nodeId);
  if (!node) return refuse("no-match", "no node found at the given id — the file may have changed");
  if (node.parentId === null) return refuse("invalid-input", "cannot remove the component's root");

  const span = findTrueSpan(byId, node, source);
  if (!spanLooksSane(source, node, span)) {
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
