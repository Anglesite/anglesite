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

// @astrojs/compiler (4.0.0) reports unreliable source positions for "expression"
// nodes: `position.start.offset` lands one character before the actual opening
// "{" (confirmed against multiple fixtures), and `position.end.offset` can be
// arbitrary/out-of-bounds garbage once the expression contains nested JSX that
// itself carries an expression (e.g. `{items.map((i) => (<li>{i}</li>))}`) —
// the reported end offset was seen to exceed the file length entirely, which
// silently truncates a naive `source.slice()`-based removal. Recompute the
// true span for expression nodes directly from the source via brace-depth
// matching (skipping string/template-literal contents) instead of trusting
// the parser's position for this node kind. Other node kinds (element,
// component, text, ...) don't exhibit this and keep their reported span.
function trueSpan(node, source) {
  if (node.kind !== "expression" || node.span[0] == null) return node.span;
  let start = node.span[0];
  while (start < source.length && source[start] !== "{") start++;
  if (start >= source.length) return node.span;

  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return [start, i + 1];
    }
  }
  return node.span;
}

function applyRemoveNode(file, source, byId, component) {
  const { nodeId } = component;
  if (typeof nodeId !== "string") {
    return refuse("invalid-input", "remove-node requires component.nodeId");
  }
  const node = byId.get(nodeId);
  if (!node) return refuse("no-match", "no node found at the given id — the file may have changed");
  if (node.parentId === null) return refuse("invalid-input", "cannot remove the component's root");
  if (node.span[0] == null || node.span[1] == null) {
    return refuse("no-match", "node has no removable span (likely the synthetic root)");
  }
  const span = trueSpan(node, source);
  if (span[0] == null || span[1] == null) {
    return refuse("no-match", "node has no removable span (likely the synthetic root)");
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
