// Shared depth-first node index for one .astro component's template — the
// single source of truth for node `id` assignment, consumed by BOTH the
// read-only component-model.mjs and the structural write resolver
// (component-structure-edit.mjs), so the two always agree on identity for
// the same source (same deterministic walk over the same parsed AST).

const JSX_CHILD_TYPES = new Set(["element", "component", "custom-element", "fragment"]);

export function isZoneNode(n) {
  return n.type === "frontmatter" || (n.type === "element" && (n.name === "style" || n.name === "script"));
}

function attrSpan(a) {
  if (!a.position?.start) return [null, null];
  const start = a.position.start.offset;
  if (a.position.end?.offset != null) return [start, a.position.end.offset];
  const text = a.kind === "empty" ? a.name : `${a.name}="${a.value}"`;
  return [start, start + text.length];
}

function attrsOf(n) {
  // NOTE: `a.value ?? null` intentionally does NOT special-case
  // `a.kind === "empty"` — @astrojs/compiler gives empty (valueless)
  // attributes like `disabled` a value of `""` (not null/undefined), and the
  // pre-refactor NodeBuilder preserved that `""` in the model's public JSON.
  // Special-casing empty attrs to `null` here would silently change
  // component-model.mjs's output for a case none of its existing tests cover.
  return (n.attributes ?? []).map((a) => ({
    name: a.name,
    value: a.value ?? null,
    span: attrSpan(a),
  }));
}

function baseSpanLoc(n) {
  const start = n.position?.start;
  const end = n.position?.end;
  return {
    span: [start?.offset ?? null, end?.offset ?? null],
    loc: start ? { line: start.line, column: start.column } : null,
  };
}

export function buildTemplateNodeIndex(ast, source) {
  const byId = new Map();
  let next = 0;
  const nextId = () => `n${next++}`;

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
          attrs: attrsOf(n),
          ...baseSpanLoc(n),
          parentId,
          childIds: [],
        };
        break;
      case "component":
      case "custom-element":
        record = { id: nextId(), kind: "component", tag: n.name, attrs: attrsOf(n), ...baseSpanLoc(n), parentId, childIds: [] };
        break;
      case "fragment":
        record = { id: nextId(), kind: "fragment", tag: null, attrs: attrsOf(n), ...baseSpanLoc(n), parentId, childIds: [] };
        break;
      case "expression": {
        record = { id: nextId(), kind: "expression", tag: null, attrs: [], ...baseSpanLoc(n), parentId, childIds: [] };
        byId.set(record.id, record);
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
        record = { id: nextId(), kind: "text", tag: null, attrs: [], text: value.slice(0, 80), ...baseSpanLoc(n), parentId, childIds: [] };
        byId.set(record.id, record);
        return record;
      }
      default:
        return null; // comment, doctype
    }
    byId.set(record.id, record);
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

  return { byId, rootId };
}
