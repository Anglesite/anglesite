// Shared depth-first node index for one .astro component's template — the
// single source of truth for node `id` assignment, consumed by BOTH the
// read-only component-model.mjs and the structural write resolver
// (component-structure-edit.mjs), so the two always agree on identity for
// the same source (same deterministic walk over the same parsed AST).

const JSX_CHILD_TYPES = new Set(["element", "component", "custom-element", "fragment"]);

export function isZoneNode(n) {
  return n.type === "frontmatter" || (n.type === "element" && (n.name === "style" || n.name === "script"));
}

// @astrojs/compiler (4.0.0) reports `position.*.offset` as a UTF-8 BYTE offset into the
// source (an artifact of the underlying WASM parser operating on byte slices), not a
// JavaScript-string (UTF-16 code unit) index. Any character that takes more than one
// UTF-8 byte — astral-plane emoji, but also ordinary accented Latin/CJK/etc characters —
// appearing anywhere EARLIER in the source makes `.offset` diverge from the index
// `source.slice()` actually needs, silently corrupting the span of every node that
// follows it (not a fixed/predictable delta — it accumulates per multi-byte character).
//
// `.line`/`.column`, by contrast, ARE computed in UTF-16 code-unit terms matching JS
// string semantics (verified directly against @astrojs/compiler@4.0.0 across text
// nodes, attribute values, and multiple/nested astral-plane characters — see
// tests/component-node-index.test.ts). So every span below is derived by converting
// (line, column) to a source-string index via `lineStarts`; `.offset` is never consulted.
//
// This does NOT fix the separate, pre-existing bug where "expression"-kind nodes report
// an off-by-one start (and an end offset that can exceed the source's length entirely)
// regardless of Unicode — that's a distinct compiler quirk in how expression boundaries
// are computed, not an offset-encoding mismatch, and line/column are equally wrong for
// those nodes. See server/component-structure-edit.mjs's `resolveAllSpans` for the
// lexical-rediscovery strategy the write path uses instead of trusting positions at all.
export function buildLineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* "\n" */) starts.push(i + 1);
  }
  return starts;
}

export function offsetFromLineColumn(lineStarts, pos) {
  if (!pos) return null;
  const lineStart = lineStarts[pos.line - 1];
  if (lineStart == null) return null;
  return lineStart + (pos.column - 1);
}

function attrSpan(a, lineStarts) {
  if (!a.position?.start) return [null, null];
  const start = offsetFromLineColumn(lineStarts, a.position.start);
  const end = offsetFromLineColumn(lineStarts, a.position.end);
  if (end != null) return [start, end];
  const text = a.kind === "empty" ? a.name : `${a.name}="${a.value}"`;
  return [start, start + text.length];
}

function attrsOf(n, lineStarts) {
  // NOTE: `a.value ?? null` intentionally does NOT special-case
  // `a.kind === "empty"` — @astrojs/compiler gives empty (valueless)
  // attributes like `disabled` a value of `""` (not null/undefined), and the
  // pre-refactor NodeBuilder preserved that `""` in the model's public JSON.
  // Special-casing empty attrs to `null` here would silently change
  // component-model.mjs's output for a case none of its existing tests cover.
  return (n.attributes ?? []).map((a) => ({
    name: a.name,
    value: a.value ?? null,
    span: attrSpan(a, lineStarts),
  }));
}

function baseSpanLoc(n, lineStarts) {
  const start = n.position?.start;
  const end = n.position?.end;
  return {
    span: [offsetFromLineColumn(lineStarts, start), offsetFromLineColumn(lineStarts, end)],
    loc: start ? { line: start.line, column: start.column } : null,
  };
}

export function buildTemplateNodeIndex(ast, source) {
  const byId = new Map();
  const astById = new Map();
  let next = 0;
  const nextId = () => `n${next++}`;
  const lineStarts = buildLineStarts(source);

  const rootId = nextId();
  const rootChildIds = [];
  byId.set(rootId, {
    id: rootId,
    kind: "fragment",
    tag: null,
    attrs: [],
    span: [0, source.length],
    loc: null,
    parentId: null,
    childIds: rootChildIds,
  });

  function visit(n, parentId) {
    let record;
    switch (n.type) {
      case "element":
        record = {
          id: nextId(),
          kind: n.name === "slot" ? "slot" : "element",
          tag: n.name,
          attrs: attrsOf(n, lineStarts),
          ...baseSpanLoc(n, lineStarts),
          parentId,
          childIds: [],
        };
        break;
      case "component":
      case "custom-element":
        record = {
          id: nextId(),
          kind: "component",
          tag: n.name,
          attrs: attrsOf(n, lineStarts),
          ...baseSpanLoc(n, lineStarts),
          parentId,
          childIds: [],
        };
        break;
      case "fragment":
        record = {
          id: nextId(),
          kind: "fragment",
          tag: null,
          attrs: attrsOf(n, lineStarts),
          ...baseSpanLoc(n, lineStarts),
          parentId,
          childIds: [],
        };
        break;
      case "expression": {
        record = { id: nextId(), kind: "expression", tag: null, attrs: [], ...baseSpanLoc(n, lineStarts), parentId, childIds: [] };
        byId.set(record.id, record);
        astById.set(record.id, n);
        for (const c of n.children ?? []) {
          if (!JSX_CHILD_TYPES.has(c.type)) continue;
          const child = visit(c, record.id);
          if (child) record.childIds.push(child.id);
        }
        return record;
      }
      case "text": {
        const value = (n.value ?? "").trim();
        if (!value) return null;
        record = {
          id: nextId(),
          kind: "text",
          tag: null,
          attrs: [],
          text: value.slice(0, 80),
          ...baseSpanLoc(n, lineStarts),
          parentId,
          childIds: [],
        };
        byId.set(record.id, record);
        astById.set(record.id, n);
        return record;
      }
      default:
        return null; // comment, doctype
    }
    byId.set(record.id, record);
    astById.set(record.id, n);
    for (const c of n.children ?? []) {
      if (isZoneNode(c)) continue;
      const child = visit(c, record.id);
      if (child) record.childIds.push(child.id);
    }
    return record;
  }

  const topLevel = (ast.children ?? []).filter((n) => !isZoneNode(n));
  for (const n of topLevel) {
    const child = visit(n, rootId);
    if (child) rootChildIds.push(child.id);
  }

  return { byId, rootId, astById };
}
