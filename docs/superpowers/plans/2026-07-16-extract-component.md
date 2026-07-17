# extract-component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `extract-component` `apply_edit` op — carve a `get_component_model` outline subtree into a brand-new `.astro` file under `src/components/`, hoist the original component's own declared Props that the subtree references, migrate simple scoped-style rules, and replace the extracted markup with a self-closing instance + import, as one atomic two-file edit.

**Architecture:** A new `component-extract-edit.mjs` resolver (same read-fresh/check-`baseVersion`/parse shape as the existing component resolvers) returns a widened result `{file, range, replacement, newFile, hoistedProps, warnings}`. `apply-edit-dispatcher.mjs` writes `newFile` (OS-atomic create-if-absent) before splicing/writing the primary file — mirroring the precedent `replace-image-src` already set for extra file-writing outside the generic single-splice path. `edit-history.mjs`'s `recordEdit` gains an optional second blob so both files land in one hidden-branch commit; `undo-edit.mjs` needs no changes (already file-count-agnostic).

**Tech Stack:** Node.js ESM, `@astrojs/compiler`, `css-tree` (via existing `css-rule-index.mjs`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-extract-component-design.md`

## Global Constraints

- `newComponentPath` must be a project-relative `.astro` path under `src/components/` (spec §1, §2 step 3).
- Only `element`/`component`/`slot`-kind nodes are extractable; refuse the component root and text/expression/fragment kinds (spec §3).
- Prop hoisting: only bare-identifier expressions (`/^[A-Za-z_$][\w$]*$/`) whose name is already one of the *original* component's own declared Props (via `parseProps`) are hoisted; everything else is left in place, never guessed at (spec §4).
- Style migration: only simple selectors (tag/class/id, no combinators/pseudo-classes) are matched against the outline tree; anything else, or a simple selector also used outside the extracted subtree, stays in the original with a `warnings` entry (spec §5).
- No general CSS-selector-vs-DOM engine, no TS/JS parser for scope analysis — deliberately regex/heuristic, fail-safe rather than guess, matching `props-interface.mjs`/`frontmatter-imports.mjs`'s existing discipline.
- `baseVersion` content-hash staleness check at resolve time AND a fresh re-check at dispatcher write time (existing generic `COMPONENT_OPS` behavior — extract-component joins that union).
- `newComponentPath` collision → refuse `exists`, both at resolve time (`existsSync`) and write time (`wx` flag), never auto-suffixed.
- ES Modules, no new runtime dependencies. Node >=22. Vitest for all new tests.
- One atomic edit = one hidden-branch commit = one undo step, even though two files are written.

---

### Task 1: `style-selector-match.mjs` — simple-selector classification and node matching

**Files:**
- Create: `server/style-selector-match.mjs`
- Test: `tests/style-selector-match.test.ts`

**Interfaces:**
- Produces: `isSimpleSelector(selector: string): boolean`, `selectorMatchesNode(selector: string, node: {tag: string|null, attrs: {name:string, value:string|null}[]}): boolean` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/style-selector-match.test.ts
import { describe, it, expect } from "vitest";
import { isSimpleSelector, selectorMatchesNode } from "../server/style-selector-match.mjs";

describe("isSimpleSelector", () => {
  it("accepts a bare tag, a bare class, a compound tag.class, an id, and multiple classes", () => {
    expect(isSimpleSelector("div")).toBe(true);
    expect(isSimpleSelector(".card")).toBe(true);
    expect(isSimpleSelector("div.card")).toBe(true);
    expect(isSimpleSelector("#hero")).toBe(true);
    expect(isSimpleSelector("div.card.featured")).toBe(true);
  });

  it("rejects combinators, pseudo-classes, :global(), and attribute selectors", () => {
    expect(isSimpleSelector(".card > h2")).toBe(false);
    expect(isSimpleSelector(".card:hover")).toBe(false);
    expect(isSimpleSelector(".parent .child")).toBe(false);
    expect(isSimpleSelector(":global(.card)")).toBe(false);
    expect(isSimpleSelector('[data-foo="bar"]')).toBe(false);
    expect(isSimpleSelector("")).toBe(false);
  });
});

describe("selectorMatchesNode", () => {
  const div = { tag: "div", attrs: [{ name: "class", value: "card featured" }] };
  const bareDiv = { tag: "div", attrs: [] };
  const withId = { tag: "section", attrs: [{ name: "id", value: "hero" }] };

  it("matches a bare tag selector against the node's own tag", () => {
    expect(selectorMatchesNode("div", div)).toBe(true);
    expect(selectorMatchesNode("section", div)).toBe(false);
  });

  it("matches a class selector when the node carries that class", () => {
    expect(selectorMatchesNode(".card", div)).toBe(true);
    expect(selectorMatchesNode(".missing", div)).toBe(false);
    expect(selectorMatchesNode(".card", bareDiv)).toBe(false);
  });

  it("requires every class in a compound selector to be present", () => {
    expect(selectorMatchesNode("div.card.featured", div)).toBe(true);
    expect(selectorMatchesNode("div.card.other", div)).toBe(false);
  });

  it("matches an id selector against the node's id attribute", () => {
    expect(selectorMatchesNode("#hero", withId)).toBe(true);
    expect(selectorMatchesNode("#other", withId)).toBe(false);
    expect(selectorMatchesNode("#hero", div)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/style-selector-match.test.ts`
Expected: FAIL — `server/style-selector-match.mjs` does not exist.

- [ ] **Step 3: Implement**

```js
// server/style-selector-match.mjs
// Purpose-built pattern matching against the outline tree's own tag/class/id
// data — NOT a general CSS-selector-vs-DOM engine. Bounded to the "obvious"
// case (a class or tag styling a node directly), consistent with this
// codebase's "deliberately regex/heuristic, refuse rather than guess"
// discipline (props-interface.mjs, frontmatter-imports.mjs). Anything with a
// combinator, pseudo-class, :global(), or attribute selector is "complex"
// and never matched here — callers treat that as "leave behind, warn."

const TAG_CLASS_RE = /^[a-zA-Z][\w-]*(\.[\w-]+)*$/;
const CLASS_ONLY_RE = /^(\.[\w-]+)+$/;
const ID_RE = /^#[\w-]+$/;

export function isSimpleSelector(selector) {
  const s = selector.trim();
  if (!s) return false;
  return TAG_CLASS_RE.test(s) || CLASS_ONLY_RE.test(s) || ID_RE.test(s);
}

export function selectorMatchesNode(selector, node) {
  const s = selector.trim();
  if (ID_RE.test(s)) {
    const id = node.attrs?.find((a) => a.name === "id")?.value;
    return id === s.slice(1);
  }
  if (!isSimpleSelector(s)) return false;
  const parts = s.split(".");
  const tag = parts[0]; // "" when the selector starts with "."
  const classes = parts.slice(1);
  if (tag && node.tag !== tag) return false;
  if (classes.length > 0) {
    const nodeClasses = (node.attrs?.find((a) => a.name === "class")?.value ?? "").split(/\s+/).filter(Boolean);
    if (!classes.every((c) => nodeClasses.includes(c))) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/style-selector-match.test.ts`
Expected: PASS (all 8 assertions across 4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/style-selector-match.mjs tests/style-selector-match.test.ts
git commit -m "feat(mcp): add style-selector-match for extract-component's rule migration"
```

---

### Task 2: Shared primitive exports (`resolveAllSpans`, `astById`, `collectElements`)

Extract-component needs four things that already exist as private/internal pieces of other modules: `resolveAllSpans`/`SpanResolutionError`/`importSpecifier`/`collectComponentTags` from `component-structure-edit.mjs`, `collectElements` from `component-model.mjs`, and a new `astById` map from `buildTemplateNodeIndex` (needed to tell attribute-*expression* values apart from literal string values — the existing public `attrs` shape only carries `{name, value, span}`, no `kind`, and adding `kind` to that shared, wire-adjacent shape is out of scope here; `astById` is an internal-only return value, never serialized into `get_component_model`'s JSON).

**Files:**
- Modify: `server/component-structure-edit.mjs` (add `export` to 4 existing declarations — no behavior change)
- Modify: `server/component-model.mjs` (add `export` to `collectElements` — no behavior change)
- Modify: `server/component-node-index.mjs` (`buildTemplateNodeIndex` additionally returns `astById`)
- Test: `tests/component-node-index.test.ts` (add one case)

**Interfaces:**
- Produces: `resolveAllSpans`, `SpanResolutionError`, `importSpecifier`, `collectComponentTags` exported from `component-structure-edit.mjs`; `collectElements` exported from `component-model.mjs`; `buildTemplateNodeIndex(ast, source)` now returns `{byId, rootId, astById}` where `astById: Map<string, AstroCompilerAstNode>` maps each `byId` entry's `id` to the raw `@astrojs/compiler` AST node it was built from (element/component/fragment/expression/text nodes only — same set `byId` covers). Consumed by Task 3 onward.

- [ ] **Step 1: Write the failing test**

```ts
// tests/component-node-index.test.ts — add this case to the existing file
it("also returns astById, mapping each node id to its raw compiler AST node", async () => {
  const source = `---\n---\n<div title={foo}><h2>Hi</h2></div>\n`;
  const { ast } = await parse(source, { position: true });
  const { byId, rootId, astById } = buildTemplateNodeIndex(ast, source);
  const div = byId.get(byId.get(rootId).childIds[0]);
  const astNode = astById.get(div.id);
  expect(astNode.type).toBe("element");
  expect(astNode.name).toBe("div");
  expect(astNode.attributes.find((a) => a.name === "title").kind).toBe("expression");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/component-node-index.test.ts -t "astById"`
Expected: FAIL — `astById` is `undefined`.

- [ ] **Step 3: Implement all four changes**

In `server/component-structure-edit.mjs`, change these four declarations to add `export` (no other change — every internal call site within the file keeps working since exported names are still in scope locally):

```js
export class SpanResolutionError extends Error {
```
```js
export function resolveAllSpans(byId, rootId, source) {
```
```js
export function importSpecifier(targetRelPath, componentRelPath) {
```
```js
export function collectComponentTags(byId, nodeId) {
```

In `server/component-model.mjs`, change:

```js
export function collectElements(node, name, out) {
```

In `server/component-node-index.mjs`, modify `buildTemplateNodeIndex` to build and return `astById`:

```js
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
```

- [ ] **Step 4: Run the full existing test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — every existing test still passes (all four exports are additive; `astById` is an additive third return value that existing `const {byId, rootId} = buildTemplateNodeIndex(...)` call sites simply don't destructure).

- [ ] **Step 5: Commit**

```bash
git add server/component-structure-edit.mjs server/component-model.mjs server/component-node-index.mjs tests/component-node-index.test.ts
git commit -m "refactor(mcp): export shared span/import primitives and astById for extract-component"
```

---

### Task 3: `component-extract-edit.mjs` core — validation, span resolution, plain subtree move

No prop hoisting, no nested-import copying, no style migration yet — those are Tasks 4–6. This task's deliverable: extracting a subtree with **no** outer-scope references and **no** nested components and **no** matching styles produces a correct two-file result on its own.

**Files:**
- Create: `server/component-extract-edit.mjs`
- Test: `tests/component-extract-edit.test.ts`

**Interfaces:**
- Consumes: `resolveAllSpans`, `SpanResolutionError`, `importSpecifier` (Task 2, `component-structure-edit.mjs`); `buildTemplateNodeIndex` (Task 2, returns `astById` too); `ensureImport` (`frontmatter-imports.mjs`); `fileVersion` (`file-version.mjs`).
- Produces: `resolveComponentExtract(projectRoot, edit): Promise<{refused: true, reason, detail} | {file, range, replacement, newFile: {path, content}, hoistedProps: string[], warnings: string[]}>` — consumed by Tasks 4–6 (same function, extended in place) and Task 9 (`patcher.mjs`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/component-extract-edit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "@astrojs/compiler";
import { resolveComponentExtract } from "../server/component-extract-edit.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { fileVersion } from "../server/file-version.mjs";

const PAGE = `---\n---\n<main>\n  <div class="hero">\n    <h1>Welcome</h1>\n  </div>\n</main>\n`;

async function nodeIndex(source) {
  const { ast } = await parse(source, { position: true });
  return buildTemplateNodeIndex(ast, source);
}

describe("resolveComponentExtract — core", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cee-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), PAGE);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refuses invalid-input with no component payload", async () => {
    const result = await resolveComponentExtract(tmpDir, { op: "extract-component" });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses stale when baseVersion does not match", async () => {
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion: "sha256:000000000000", nodeId: "n1", newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("refuses invalid-input for newComponentPath outside src/components/", async () => {
    const baseVersion = fileVersion(PAGE);
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/pages/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses invalid-input when extracting the component's root", async () => {
    const baseVersion = fileVersion(PAGE);
    const { rootId } = await nodeIndex(PAGE);
    // rootId IS a real byId entry (the synthetic fragment root, parentId: null) — resolveComponentExtract's
    // parentId === null check refuses it as invalid-input, same as remove-node's "cannot remove the
    // component's root" rule. Extracting a real top-level node like <main> is unaffected by this check
    // (its own parentId is rootId, not null) — already exercised by the "extracts a subtree..." test below,
    // which extracts the doubly-nested <div>.
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: rootId, newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses no-match when the nodeId no longer exists", async () => {
    const baseVersion = fileVersion(PAGE);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: "n999", newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });

  it("refuses exists when newComponentPath already has a file on disk", async () => {
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), "<p>taken</p>\n");
    const baseVersion = fileVersion(PAGE);
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("exists");
  });

  it("extracts a subtree with no outer references into a new file and leaves a self-closing instance behind", async () => {
    const baseVersion = fileVersion(PAGE);
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    expect(result.newFile.path).toBe("src/components/Hero.astro");
    expect(result.newFile.content).toContain('<div class="hero">');
    expect(result.newFile.content).toContain("<h1>Welcome</h1>");
    expect(result.hoistedProps).toEqual([]);
    expect(result.warnings).toEqual([]);

    const next = result.replacement; // whole-file rewrite: range covers [0, source.length]
    expect(result.range).toEqual({ start: 0, end: PAGE.length });
    expect(next).toContain("<Hero />");
    expect(next).not.toContain('<div class="hero">');
    expect(next).toMatch(/import Hero from "\.\/Hero\.astro";/);
  });

  it("refuses invalid-input for a text-kind node", async () => {
    const source = `---\n---\n<p>plain text</p>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const p = byId.get(byId.get(rootId).childIds[0]);
    const textNode = byId.get(p.childIds[0]);
    expect(textNode.kind).toBe("text");
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: textNode.id, newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: FAIL — `server/component-extract-edit.mjs` does not exist.

- [ ] **Step 3: Implement**

```js
// server/component-extract-edit.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, normalize, basename, sep } from "node:path";
import { parse } from "@astrojs/compiler";
import { fileVersion } from "./file-version.mjs";
import { buildTemplateNodeIndex } from "./component-node-index.mjs";
import { resolveAllSpans, SpanResolutionError, importSpecifier } from "./component-structure-edit.mjs";
import { ensureImport } from "./frontmatter-imports.mjs";

/**
 * Write-side resolver for extract-component (Component Editor Slice 5). Unlike every other
 * component op, this one touches TWO files: it carves `nodeId`'s subtree out of the target
 * component into a brand-new file at `newComponentPath`, and replaces the subtree in the
 * original with a self-closing instance + import. Returns the widened
 * `{file, range, replacement, newFile, hoistedProps, warnings}` shape apply-edit-dispatcher.mjs
 * knows how to write as one atomic two-file edit (see docs/superpowers/specs/
 * 2026-07-16-extract-component-design.md).
 */

function refuse(reason, detail) {
  return { refused: true, reason, detail };
}

function validComponentPath(relPath) {
  return typeof relPath === "string" && relPath.endsWith(".astro") && !normalize(relPath).startsWith("..") && !relPath.startsWith("/");
}

function validNewComponentPath(relPath) {
  if (!validComponentPath(relPath)) return false;
  const normalized = normalize(relPath).split(sep).join("/");
  return normalized.startsWith("src/components/");
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
  const { byId, rootId, astById } = buildTemplateNodeIndex(ast, source);
  return { source, ast, byId, rootId, astById };
}

function rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath) {
  const fmMatch = afterNode.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  const specifier = importSpecifier(relPath, newComponentPath);
  if (fmMatch) {
    const [, open, fmBody] = fmMatch;
    const fmBodyStart = fmMatch.index + open.length;
    const { source: newFmBody } = ensureImport(fmBody, { localName: componentName, specifier });
    return afterNode.slice(0, fmBodyStart) + newFmBody + afterNode.slice(fmBodyStart + fmBody.length);
  }
  const importLine = `import ${componentName} from "${specifier}";\n`;
  return `---\n${importLine}---\n${afterNode}`;
}

export async function resolveComponentExtract(projectRoot, edit) {
  const { component } = edit;
  if (!component || typeof component !== "object") {
    return refuse("invalid-input", "component payload is required for this op");
  }
  const { path: relPath, baseVersion, nodeId, newComponentPath } = component;
  if (!validComponentPath(relPath)) {
    return refuse("invalid-input", `not a project-relative .astro path: ${relPath}`);
  }
  if (typeof nodeId !== "string") {
    return refuse("invalid-input", "extract-component requires component.nodeId");
  }
  if (!validNewComponentPath(newComponentPath)) {
    return refuse("invalid-input", `newComponentPath must be a project-relative .astro path under src/components/: ${newComponentPath}`);
  }

  const loaded = await loadFresh(projectRoot, relPath, baseVersion);
  if (loaded.error) return loaded.error;
  const { source, byId, rootId } = loaded;

  const node = byId.get(nodeId);
  if (!node) return refuse("no-match", "no node found at the given id — the file may have changed");
  if (node.parentId === null) return refuse("invalid-input", "cannot extract the component's root");
  if (node.kind !== "element" && node.kind !== "component" && node.kind !== "slot") {
    return refuse("invalid-input", `extract-component requires a tag-shaped node (element/component/slot), got kind=${node.kind}`);
  }

  if (existsSync(join(projectRoot, newComponentPath))) {
    return refuse("exists", `${newComponentPath} already exists`);
  }

  let spans;
  try {
    spans = resolveAllSpans(byId, rootId, source);
  } catch (err) {
    if (!(err instanceof SpanResolutionError)) throw err;
    return refuse(
      "no-match",
      "could not lexically re-locate the node's true source span without trusting compiler offsets — refusing rather than risking corruption",
    );
  }
  const nodeSpan = spans.get(nodeId);
  if (!nodeSpan) {
    return refuse(
      "no-match",
      "could not lexically re-locate the node's true source span without trusting compiler offsets — refusing rather than risking corruption",
    );
  }

  const subtreeText = source.slice(nodeSpan[0], nodeSpan[1]);
  const componentName = basename(newComponentPath, ".astro");

  const instanceTag = `<${componentName} />`;
  const afterNode = source.slice(0, nodeSpan[0]) + instanceTag + source.slice(nodeSpan[1]);
  const afterImport = rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath);

  return {
    file: relPath,
    range: { start: 0, end: source.length },
    replacement: afterImport,
    newFile: { path: newComponentPath, content: `${subtreeText}\n` },
    hoistedProps: [],
    warnings: [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/component-extract-edit.mjs tests/component-extract-edit.test.ts
git commit -m "feat(mcp): add component-extract-edit core resolver (plain subtree move)"
```

---

### Task 4: Prop hoisting

Extends `resolveComponentExtract` to hoist bare-identifier expressions that are the *original* component's own declared Props (spec §4).

**Files:**
- Modify: `server/component-extract-edit.mjs`
- Test: `tests/component-extract-edit.test.ts` (add cases)

**Interfaces:**
- Consumes: `parseProps`, `generatePropsInterface`, `generatePropsDestructure` (`props-interface.mjs`); `astById` (Task 2).
- Produces: `resolveComponentExtract`'s `hoistedProps` is now populated; the instance tag carries hoisted-prop attributes; the new file gets a Props interface/destructure.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/component-extract-edit.test.ts — add to the same describe block
it("hoists a bare-identifier attribute expression that is one of the original's own Props", async () => {
  const source = `---\ninterface Props { title: string; }\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero" data-label={title}>\n    <h1>Static</h1>\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.refused).toBeFalsy();
  expect(result.hoistedProps).toEqual(["title"]);
  expect(result.newFile.content).toContain("interface Props {\n  title: string;\n}");
  expect(result.newFile.content).toContain("const { title } = Astro.props;");
  expect(result.replacement).toContain("<Hero title={title} />");
});

it("hoists a bare-identifier text-content expression that is one of the original's own Props", async () => {
  const source = `---\ninterface Props { title: string; }\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero">\n    <h1>{title}</h1>\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.hoistedProps).toEqual(["title"]);
  expect(result.newFile.content).toContain("<h1>{title}</h1>");
});

it("does not hoist a bare identifier that is not one of the original's own Props", async () => {
  const source = `---\nconst label = "computed";\n---\n<main>\n  <div class="hero">\n    <h1>{label}</h1>\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.hoistedProps).toEqual([]);
  expect(result.newFile.content).toContain("<h1>{label}</h1>"); // left in place, unhoisted
  expect(result.newFile.content).not.toContain("interface Props");
});

it("does not hoist a non-bare-identifier expression even when it references an original Prop", async () => {
  const source = `---\ninterface Props { title: string; }\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero">\n    <h1>{title.toUpperCase()}</h1>\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.hoistedProps).toEqual([]);
  expect(result.newFile.content).toContain("<h1>{title.toUpperCase()}</h1>");
});

it("dedups the same identifier referenced twice into one hoisted prop", async () => {
  const source = `---\ninterface Props { title: string; }\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero" data-label={title}>\n    <h1>{title}</h1>\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.hoistedProps).toEqual(["title"]);
  expect(result.replacement.match(/title=\{title\}/g)).toHaveLength(1); // one instance attr, not two
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: FAIL — `hoistedProps` stays `[]`, instance tag has no attrs, new file has no Props interface.

- [ ] **Step 3: Implement**

Add these imports and helpers to `server/component-extract-edit.mjs`, and rewire `resolveComponentExtract`'s body between `spans`/`nodeSpan` resolution and the `instanceTag`/`afterNode` construction:

```js
// add to the top-of-file imports
import { parseProps, generatePropsInterface, generatePropsDestructure } from "./props-interface.mjs";
```

```js
const BARE_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;

function collectSubtreeIds(byId, nodeId) {
  const ids = [];
  (function walk(id) {
    ids.push(id);
    for (const c of byId.get(id).childIds) walk(c);
  })(nodeId);
  return ids;
}

/**
 * Bare-identifier expressions (attribute values AND text-content expression children)
 * inside the subtree whose name is one of the original component's own declared Props.
 * Anything else — a non-identifier expression, or an identifier that isn't an original
 * Prop — is left alone; see the Global Constraints note on hoisting scope. Returns prop
 * records sorted by name (the module's `props` shape: {name, type, optional, default}).
 */
function findHoistCandidates(byId, astById, subtreeIds, spans, source, originalProps) {
  const ownProps = new Map(originalProps.map((p) => [p.name, p]));
  const hoisted = new Map();

  function consider(text) {
    const trimmed = text.trim();
    if (!BARE_IDENTIFIER_RE.test(trimmed)) return;
    const prop = ownProps.get(trimmed);
    if (prop) hoisted.set(trimmed, { name: prop.name, type: prop.type, optional: prop.optional, default: null });
  }

  for (const id of subtreeIds) {
    const node = byId.get(id);
    const astNode = astById.get(id);
    if (astNode && Array.isArray(astNode.attributes)) {
      for (const a of astNode.attributes) {
        if (a.kind === "expression") consider(a.value ?? "");
      }
    }
    if (node.kind === "expression") {
      const span = spans.get(id);
      if (span) consider(source.slice(span[0], span[1]).replace(/^\{/, "").replace(/\}$/, ""));
    }
  }
  return [...hoisted.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

In `resolveComponentExtract`, right after `nodeSpan`/`subtreeText` are resolved and before building `instanceTag`, insert:

```js
  const origFmMatch = source.match(FRONTMATTER_RE);
  const originalProps = origFmMatch ? parseProps(origFmMatch[2]) : [];
  const subtreeIds = collectSubtreeIds(byId, nodeId);
  const hoistedPropRecords = findHoistCandidates(byId, loaded.astById, subtreeIds, spans, source, originalProps);
```

Replace the `instanceTag`/`newFile.content` construction with:

```js
  const instanceAttrs = hoistedPropRecords.map((p) => ` ${p.name}={${p.name}}`).join("");
  const instanceTag = `<${componentName}${instanceAttrs} />`;
  const afterNode = source.slice(0, nodeSpan[0]) + instanceTag + source.slice(nodeSpan[1]);
  const afterImport = rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath);

  const propsInterface = generatePropsInterface(hoistedPropRecords);
  const propsDestructure = generatePropsDestructure(hoistedPropRecords);
  const fmParts = [propsInterface, propsDestructure].filter(Boolean);
  const newFm = fmParts.length ? `---\n${fmParts.join("\n")}\n---\n` : "";

  return {
    file: relPath,
    range: { start: 0, end: source.length },
    replacement: afterImport,
    newFile: { path: newComponentPath, content: `${newFm}${subtreeText}\n` },
    hoistedProps: hoistedPropRecords.map((p) => p.name),
    warnings: [],
  };
```

(`loaded.astById` requires `loadFresh`'s destructure at the top of the function to keep `astById` — change `const { source, byId, rootId } = loaded;` to `const { source, byId, rootId, astById } = loaded;` and use `astById` directly in place of `loaded.astById` above for consistency with the rest of the function's naming.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: PASS (13 tests total)

- [ ] **Step 5: Commit**

```bash
git add server/component-extract-edit.mjs tests/component-extract-edit.test.ts
git commit -m "feat(mcp): hoist bare-identifier own-Props references in extract-component"
```

---

### Task 5: Nested-component import copying + prune-if-unused

When the extracted subtree contains a component-kind descendant (e.g. `<Badge />` inside the extracted `<Hero>` markup), that import must move: copied into the new file's frontmatter (re-based to the new file's directory), and pruned from the original's frontmatter if it's no longer used anywhere in what remains.

**Files:**
- Modify: `server/component-extract-edit.mjs`
- Test: `tests/component-extract-edit.test.ts` (add cases)

**Interfaces:**
- Consumes: `collectComponentTags` (Task 2, `component-structure-edit.mjs`); `parseImports`, `pruneImportIfUnused` (`frontmatter-imports.mjs`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/component-extract-edit.test.ts — add to the same describe block
it("copies a nested component's import into the new file, re-based to its directory, and prunes it from the original when unused elsewhere", async () => {
  const source = `---\nimport Badge from "./Badge.astro";\n---\n<main>\n  <div class="hero">\n    <Badge />\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "<span>Badge</span>\n");
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.refused).toBeFalsy();
  expect(result.newFile.content).toMatch(/import Badge from "\.\/Badge\.astro";/);
  expect(result.newFile.content).toContain("<Badge />");
  expect(result.replacement).not.toContain("import Badge"); // pruned — no longer used in the original
  expect(result.replacement).toMatch(/import Hero from "\.\/Hero\.astro";/);
});

it("keeps a nested component's import in the original when it's also used outside the extracted subtree", async () => {
  const source = `---\nimport Badge from "./Badge.astro";\n---\n<main>\n  <Badge />\n  <div class="hero">\n    <Badge />\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "<span>Badge</span>\n");
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[1]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.replacement).toMatch(/import Badge from "\.\/Badge\.astro";/); // still needed for the sibling <Badge />
  expect(result.newFile.content).toMatch(/import Badge from "\.\/Badge\.astro";/); // also copied — extracted one still needs it
});

it("re-bases a nested component's relative import specifier for a new file in a different directory", async () => {
  mkdirSync(join(tmpDir, "src", "components", "sections"), { recursive: true });
  const source = `---\nimport Badge from "../Badge.astro";\n---\n<main>\n  <div class="hero">\n    <Badge />\n  </div>\n</main>\n`;
  writeFileSync(join(tmpDir, "src", "components", "sections", "Page.astro"), source);
  writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "<span>Badge</span>\n");
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/sections/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  // Hero.astro lives directly under src/components/, so its import of Badge.astro (a sibling) is "./Badge.astro",
  // not the "../Badge.astro" that was correct from sections/Page.astro's own directory.
  expect(result.newFile.content).toMatch(/import Badge from "\.\/Badge\.astro";/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: FAIL — new file has no `Badge` import; original still has it unconditionally.

- [ ] **Step 3: Implement**

Add to the imports:

```js
import { collectComponentTags } from "./component-structure-edit.mjs";
import { parseImports, pruneImportIfUnused } from "./frontmatter-imports.mjs";
```

Add a helper that re-bases a relative import specifier from one file's directory to another's:

```js
import { dirname, relative } from "node:path";

function resolveImportTargetPath(originalRelPath, specifier) {
  const abs = normalize(join(dirname(originalRelPath), specifier));
  return abs.split(sep).join("/");
}

function importLinesForNewFile(originalFmBody, movedComponentNames, relPath, newComponentPath) {
  const origImports = parseImports(originalFmBody ?? "");
  return movedComponentNames
    .map((name) => origImports.find((i) => i.localName === name))
    .filter(Boolean)
    .map((imp) => {
      const targetRelPath = resolveImportTargetPath(relPath, imp.specifier);
      return `import ${imp.localName} from "${importSpecifier(newComponentPath, targetRelPath)}";\n`;
    })
    .join("");
}
```

Change `rewriteOriginalFrontmatter` to also prune now-unused moved-component imports:

```js
function rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath, movedComponentNames) {
  const fmMatch = afterNode.match(FRONTMATTER_RE);
  const specifier = importSpecifier(relPath, newComponentPath);
  const ensureAndPrune = (fmBody) => {
    let body = ensureImport(fmBody, { localName: componentName, specifier }).source;
    for (const name of movedComponentNames) {
      body = pruneImportIfUnused(body, afterNode, name).source;
    }
    return body;
  };
  if (fmMatch) {
    const [, open, fmBody] = fmMatch;
    const fmBodyStart = fmMatch.index + open.length;
    const newFmBody = ensureAndPrune(fmBody);
    return afterNode.slice(0, fmBodyStart) + newFmBody + afterNode.slice(fmBodyStart + fmBody.length);
  }
  const importLine = `import ${componentName} from "${specifier}";\n`;
  return `---\n${importLine}---\n${afterNode}`;
}
```

In `resolveComponentExtract`, compute `movedComponentNames` alongside `hoistedPropRecords` and thread it through:

```js
  const movedComponentNames = collectComponentTags(byId, nodeId);
```

Update the call site: `rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath, movedComponentNames)`.

Update the new file's frontmatter assembly to include the copied import lines:

```js
  const importLines = importLinesForNewFile(origFmMatch ? origFmMatch[2] : "", movedComponentNames, relPath, newComponentPath);
  const propsInterface = generatePropsInterface(hoistedPropRecords);
  const propsDestructure = generatePropsDestructure(hoistedPropRecords);
  const fmParts = [importLines ? importLines.trimEnd() : null, propsInterface, propsDestructure].filter(Boolean);
  const newFm = fmParts.length ? `---\n${fmParts.join("\n")}\n---\n` : "";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: PASS (16 tests total)

- [ ] **Step 5: Commit**

```bash
git add server/component-extract-edit.mjs tests/component-extract-edit.test.ts
git commit -m "feat(mcp): copy/prune nested-component imports in extract-component"
```

---

### Task 6: Style-rule migration

Migrates simple-selector rules that exclusively target the extracted subtree; leaves shared or complex-selector rules behind with a `warnings` entry (spec §5).

**Files:**
- Modify: `server/component-extract-edit.mjs`
- Test: `tests/component-extract-edit.test.ts` (add cases)

**Interfaces:**
- Consumes: `isSimpleSelector`, `selectorMatchesNode` (Task 1); `collectElements` (Task 2, `component-model.mjs`); `indexCssRules` (`css-rule-index.mjs`); `buildLineStarts` (`component-node-index.mjs`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/component-extract-edit.test.ts — add to the same describe block
it("moves a simple-selector rule that only targets nodes inside the extracted subtree", async () => {
  const source = `---\n---\n<main>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  .hero {\n    color: blue;\n  }\n</style>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.warnings).toEqual([]);
  expect(result.newFile.content).toContain(".hero {\n    color: blue;\n  }");
  expect(result.replacement).not.toContain("color: blue");
  // The rule's own text is gone, but removeMovedRules only strips the {...} block it matched —
  // it does not clean up a now-empty surrounding <style></style> shell (documented limitation,
  // see the note under Step 3 below). Assert the shell is empty rather than asserting it's gone.
  expect(result.replacement).toMatch(/<style>\s*<\/style>/);
});

it("keeps a simple-selector rule in the original and reports a warning when it's also used outside the extracted subtree", async () => {
  const source = `---\n---\n<main>\n  <p class="hero">Outside</p>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  .hero {\n    color: blue;\n  }\n</style>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[1]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.warnings).toEqual([".hero not moved: also used outside the extracted markup"]);
  expect(result.replacement).toContain("color: blue"); // stays in the original
  expect(result.newFile.content).not.toContain("<style>");
});

it("keeps a complex-selector rule in the original and reports a warning", async () => {
  const source = `---\n---\n<main>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  .hero > h1 {\n    color: blue;\n  }\n</style>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[0]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.warnings).toEqual([".hero > h1 not moved: selector too complex to analyze automatically"]);
  expect(result.replacement).toContain("color: blue");
});

it("splits a media-query block when only some of its rules move", async () => {
  const source = `---\n---\n<main>\n  <p class="kept">Kept</p>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  @media (min-width: 40em) {\n    .hero {\n      color: blue;\n    }\n    .kept {\n      color: red;\n    }\n  }\n</style>\n`;
  writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
  const baseVersion = fileVersion(source);
  const { byId, rootId } = await nodeIndex(source);
  const main = byId.get(byId.get(rootId).childIds[0]);
  const div = byId.get(main.childIds[1]);
  const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

  const result = await resolveComponentExtract(tmpDir, edit);
  expect(result.warnings).toEqual([]);
  expect(result.newFile.content).toMatch(/@media \(min-width: 40em\)[\s\S]*\.hero[\s\S]*color: blue/);
  expect(result.replacement).toMatch(/@media \(min-width: 40em\)[\s\S]*\.kept[\s\S]*color: red/);
  expect(result.replacement).not.toContain(".hero");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: FAIL — `warnings` stays `[]` even for complex/shared selectors, and no rules ever move.

- [ ] **Step 3: Implement**

Add to the imports:

```js
import { collectElements } from "./component-model.mjs";
import { indexCssRules } from "./css-rule-index.mjs";
import { buildLineStarts } from "./component-node-index.mjs";
import { isSimpleSelector, selectorMatchesNode } from "./style-selector-match.mjs";
```

Add the classification and rule-text helpers:

```js
function anyNodeMatches(byId, nodeIds, selector) {
  return nodeIds.some((id) => selectorMatchesNode(selector, byId.get(id)));
}

/**
 * `selectorMatchesNode` (Task 1) returns false outright for any non-simple selector — it
 * doesn't understand combinators, so it can't itself tell whether a complex selector like
 * ".hero > h1" "touches" the subtree. For the complex-selector warning we don't need real
 * combinator matching, just a signal of "plausibly related to this subtree" — so split on
 * whitespace/combinators, strip pseudo-classes/attribute-selector brackets, and check whether
 * any resulting SIMPLE token matches a subtree node. ".hero > h1" tokenizes to [".hero", "h1"];
 * either one matching the extracted <div class="hero"> is enough to warn.
 */
function selectorTouchesNodes(selector, byId, nodeIds) {
  const tokens = selector
    .split(/[\s>+~]+/)
    .map((tok) => tok.replace(/:[\w-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, ""))
    .filter(Boolean);
  return tokens.some((tok) => isSimpleSelector(tok) && anyNodeMatches(byId, nodeIds, tok));
}

/** Splits `rules` into ones to move (simple selector, exclusively inside the subtree) and
 *  warnings for everything else that touches the subtree but can't safely move. */
function classifyStyleRules(byId, subtreeIds, outsideIds, rules) {
  const toMove = [];
  const warnings = [];
  for (const rule of rules) {
    if (!isSimpleSelector(rule.selector)) {
      if (selectorTouchesNodes(rule.selector, byId, subtreeIds)) {
        warnings.push(`${rule.selector} not moved: selector too complex to analyze automatically`);
      }
      continue;
    }
    const insideMatch = anyNodeMatches(byId, subtreeIds, rule.selector);
    if (!insideMatch) continue;
    if (anyNodeMatches(byId, outsideIds, rule.selector)) {
      warnings.push(`${rule.selector} not moved: also used outside the extracted markup`);
      continue;
    }
    toMove.push(rule);
  }
  return { toMove, warnings };
}

function sameRule(a, b) {
  return a.selector === b.selector && a.media === b.media && JSON.stringify(a.declarations) === JSON.stringify(b.declarations);
}

function removeRuleSpan(text, span) {
  let start = span[0];
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
  if (start > 0 && text[start - 1] === "\n") start--;
  return text.slice(0, start) + text.slice(span[1]);
}

/** Removes each `toMove` rule from `text` one at a time, re-parsing/re-indexing fresh before
 *  each removal (rather than composing stale offsets) — the same "never trust a stale offset,
 *  always re-derive against the current string" discipline the rest of this codebase uses. */
async function removeMovedRules(text, toMove) {
  let current = text;
  for (const target of toMove) {
    const { ast } = await parse(current, { position: true });
    const lineStarts = buildLineStarts(current);
    const styleEls = [];
    collectElements(ast, "style", styleEls);
    const rules = styleEls.flatMap((el) => indexCssRules(el, lineStarts));
    const match = rules.find((r) => sameRule(r, target));
    if (!match) continue; // defensive: rule text/media/declarations are stable across re-parses
    current = removeRuleSpan(current, match.span);
  }
  return current;
}

function indent(text) {
  return text.split("\n").map((l) => (l ? "  " + l : l)).join("\n");
}

function buildMovedStyleBlock(source, toMove) {
  if (toMove.length === 0) return "";
  const byMedia = new Map();
  for (const rule of toMove) {
    const key = rule.media ?? "";
    if (!byMedia.has(key)) byMedia.set(key, []);
    byMedia.get(key).push(rule);
  }
  const blocks = [];
  for (const [media, rules] of byMedia) {
    const ruleTexts = rules.map((r) => source.slice(r.span[0], r.span[1])).join("\n\n");
    blocks.push(media ? `@media ${media} {\n${indent(ruleTexts)}\n}` : ruleTexts);
  }
  return `\n<style>\n${blocks.join("\n\n")}\n</style>\n`;
}
```

Note: `removeMovedRules` only removes each rule's own `{...}` block. It never cleans up a now-possibly-empty surrounding `@media (...) {}` wrapper, nor a now-possibly-empty `<style></style>` shell when the moved rule was the only one in that `<style>` block — that's a documented, harmless known limitation (valid, inert CSS/markup left behind), not a correctness bug; cleaning it up is out of scope (see spec §5's non-goals on not building a general CSS engine).

In `resolveComponentExtract`, after `subtreeIds` is computed, add the outside-id set and rule classification:

```js
  const outsideIds = [...byId.keys()].filter((id) => id !== rootId && !subtreeIds.includes(id));
  const styleElements = [];
  collectElements(loaded.ast, "style", styleElements);
  const lineStarts = buildLineStarts(source);
  const allRules = styleElements.flatMap((el) => indexCssRules(el, lineStarts));
  const { toMove, warnings } = classifyStyleRules(byId, subtreeIds, outsideIds, allRules);
```

(`loaded.ast` requires keeping `ast` in `loadFresh`'s returned/destructured object — change `const { source, byId, rootId, astById } = loaded;` to also keep `loaded.ast`, or destructure `ast` too: `const { source, ast, byId, rootId, astById } = loaded;`.)

Change the function's final return to route the primary replacement through `removeMovedRules` and append the moved style block to the new file, and thread real `warnings` through instead of `[]`:

```js
  const finalReplacement = await removeMovedRules(afterImport, toMove);
  const styleBlock = buildMovedStyleBlock(source, toMove);

  return {
    file: relPath,
    range: { start: 0, end: source.length },
    replacement: finalReplacement,
    newFile: { path: newComponentPath, content: `${newFm}${subtreeText}\n${styleBlock}` },
    hoistedProps: hoistedPropRecords.map((p) => p.name),
    warnings,
  };
```

(`resolveComponentExtract` is now `async` at its outermost call already — no change needed there — but the new `await removeMovedRules(...)` call means this must run inside the existing `async function resolveComponentExtract`, which it already is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/component-extract-edit.test.ts`
Expected: PASS (20 tests total)

- [ ] **Step 5: Commit**

```bash
git add server/component-extract-edit.mjs tests/component-extract-edit.test.ts
git commit -m "feat(mcp): migrate simple-selector style rules in extract-component"
```

---

### Task 7: Wire `apply-edit-schema.mjs`

**Files:**
- Modify: `server/apply-edit-schema.mjs`
- Test: `tests/apply-edit-schema-extract.test.ts`

**Interfaces:**
- Produces: `"extract-component"` added to `editOps`; new `COMPONENT_EXTRACT_OPS` set, folded into `COMPONENT_OPS`; `componentEditSchema.newComponentPath`; `createEditPreviewContent`'s new optional `newFile` param.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/apply-edit-schema-extract.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  editOps,
  componentEditSchema,
  applyEditInputShape,
  COMPONENT_EXTRACT_OPS,
  COMPONENT_OPS,
  createEditPreviewContent,
} from "../server/apply-edit-schema.mjs";

describe("extract-component schema", () => {
  it("registers extract-component in editOps, COMPONENT_EXTRACT_OPS, and COMPONENT_OPS", () => {
    expect(editOps).toContain("extract-component");
    expect(COMPONENT_EXTRACT_OPS.has("extract-component")).toBe(true);
    expect(COMPONENT_OPS.has("extract-component")).toBe(true);
  });

  it("accepts an extract-component payload with nodeId and newComponentPath", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Page.astro",
      baseVersion: "sha256:abc123456789",
      nodeId: "n3",
      newComponentPath: "src/components/Hero.astro",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full apply_edit input for extract-component", () => {
    const schema = z.object(applyEditInputShape);
    const result = schema.safeParse({
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion: "sha256:abc123456789", nodeId: "n3", newComponentPath: "src/components/Hero.astro" },
    });
    expect(result.success).toBe(true);
  });

  it("createEditPreviewContent includes newFile when provided, omits it otherwise", () => {
    const withNewFile = JSON.parse(createEditPreviewContent("1", "a.astro", { start: 0, end: 1 }, "extract-component", "before", "after", { path: "b.astro", after: "content" }).text);
    expect(withNewFile.newFile).toEqual({ path: "b.astro", after: "content" });

    const without = JSON.parse(createEditPreviewContent("1", "a.astro", { start: 0, end: 1 }, "set-attr", "before", "after").text);
    expect(without.newFile).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/apply-edit-schema-extract.test.ts`
Expected: FAIL — `extract-component` not in `editOps`, `COMPONENT_EXTRACT_OPS` undefined, `newComponentPath` rejected, `createEditPreviewContent` ignores its 7th arg.

- [ ] **Step 3: Implement**

In `server/apply-edit-schema.mjs`:

```js
export const editOps = [
  "replace-text",
  "replace-attr",
  "replace-image-src",
  "edit-style",
  "apply-instruction",
  "set-style-property",
  "remove-style-property",
  "add-style-rule",
  "set-rule-selector",
  "insert-node",
  "move-node",
  "remove-node",
  "set-attr",
  "set-props-interface",
  "set-script-zone",
  "extract-component",
];
```

```js
/** Extract-component: carves a get_component_model outline subtree into a new .astro file
 *  under src/components/, replacing it in place with a component instance + import. The only
 *  op whose resolution touches two files — see component-extract-edit.mjs. */
export const COMPONENT_EXTRACT_OPS = new Set(["extract-component"]);

/** Union of style, structure, frontmatter, and extract component ops — used by the dispatcher's shared checks. */
export const COMPONENT_OPS = new Set([
  ...COMPONENT_STYLE_OPS,
  ...COMPONENT_STRUCTURE_OPS,
  ...COMPONENT_FRONTMATTER_OPS,
  ...COMPONENT_EXTRACT_OPS,
]);
```

Add to `componentEditSchema` (alongside the existing `zone`/`source` fields at the end, before the closing `});`):

```js
  newComponentPath: z
    .string()
    .optional()
    .describe("Project-relative .astro path under src/components/ for the new component — required for extract-component"),
```

Update `createEditPreviewContent`:

```js
export function createEditPreviewContent(id, file, range, op, before, after, newFile) {
  const body = { type: "anglesite:edit-preview", id, file, range, op, before, after };
  if (newFile !== undefined) body.newFile = newFile;
  return { type: "text", text: JSON.stringify(body) };
}
```

Update the `op` field's description in `applyEditInputShape` to mention the new op (append to the existing description string): `"... set-props-interface/set-script-zone (component-frontmatter ops — see componentEditSchema), extract-component (carves an outline subtree into a new component under src/components/ — see componentEditSchema's nodeId/newComponentPath)"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/apply-edit-schema-extract.test.ts && npx vitest run tests/apply-edit-schema-structure.test.ts tests/apply-edit-schema-frontmatter.test.ts`
Expected: PASS — new tests pass, existing schema tests still pass (additive changes only).

- [ ] **Step 5: Commit**

```bash
git add server/apply-edit-schema.mjs tests/apply-edit-schema-extract.test.ts
git commit -m "feat(mcp): add extract-component to the apply_edit wire schema"
```

---

### Task 8: Extend `edit-history.mjs`'s `recordEdit` for a second file

**Files:**
- Modify: `server/edit-history.mjs`
- Test: `test/edit-history.test.js` (add cases — note: JS, under `test/`, matching this file's existing location per CLAUDE.md's test layout)

**Interfaces:**
- Produces: `recordEdit(projectRoot, {file, range, newFile?: {path: string}, message?})` — `newFile.path`'s on-disk content (already written by the dispatcher by the time this runs) is staged into the same commit as `file`.

- [ ] **Step 1: Write the failing tests**

```js
// test/edit-history.test.js — add to the existing describe("recordEdit", ...) block
it("stages a second file into the same commit when newFile is provided", async () => {
  writeFileSync(join(repo, "README.md"), "edited\n");
  mkdirSync(join(repo, "src", "components"), { recursive: true });
  writeFileSync(join(repo, "src", "components", "Hero.astro"), "<div>Hero</div>\n");

  const sha = await recordEdit(repo, {
    file: "README.md",
    range: { start: 0, end: 7 },
    newFile: { path: "src/components/Hero.astro" },
    message: "extract Hero",
  });

  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  expect(git(["show", `${sha}:README.md`])).toBe("edited");
  expect(git(["show", `${sha}:src/components/Hero.astro`])).toBe("<div>Hero</div>");
  // Both files land in ONE commit, not two.
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).split(/\s+/);
  expect(parents).toHaveLength(2); // sha itself + exactly one parent
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/edit-history.test.js -t "stages a second file"`
Expected: FAIL — `recordEdit` ignores `newFile`, `src/components/Hero.astro` isn't in the commit.

- [ ] **Step 3: Implement**

In `server/edit-history.mjs`, change `recordEdit`'s signature and body:

```js
/**
 * @param {string} projectRoot
 * @param {{ file: string, range: {start:number,end:number}, newFile?: {path: string}, message?: string }} info
 * @returns {Promise<string | undefined>} commit SHA, or undefined on any failure
 */
export async function recordEdit(projectRoot, { file, range, newFile, message }) {
  if (!isGitRepo(projectRoot)) return undefined;

  try {
    const existing = tryRunGit(projectRoot, ["show-ref", "--verify", "--hash", EDITS_REF]);
    if (!existing) {
      const head = tryRunGit(projectRoot, ["rev-parse", "HEAD"]);
      if (!head) return undefined;
      runGit(projectRoot, ["update-ref", EDITS_REF, head]);
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "anglesite-edit-idx-"));
    const tmpIndex = join(tmpDir, "index");
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      runGit(projectRoot, ["read-tree", EDITS_REF], env);
      const blob = runGit(projectRoot, ["hash-object", "-w", "--", file]);
      runGit(projectRoot, ["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`], env);
      if (newFile) {
        const newBlob = runGit(projectRoot, ["hash-object", "-w", "--", newFile.path]);
        runGit(projectRoot, ["update-index", "--add", "--cacheinfo", `100644,${newBlob},${newFile.path}`], env);
      }
      const tree = runGit(projectRoot, ["write-tree"], env);
      const parent = runGit(projectRoot, ["rev-parse", EDITS_REF]);
      const commit = runGit(projectRoot, [
        "commit-tree", tree, "-p", parent, "-m", formatMessage({ file, range, message }),
      ]);
      runGit(projectRoot, ["update-ref", EDITS_REF, commit, parent]);
      return commit;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    return undefined;
  }
}
```

(Only the signature and the one new `if (newFile) { ... }` block change; everything else is unchanged from the existing implementation.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/edit-history.test.js`
Expected: PASS — the new test plus all existing `recordEdit` tests (single-file calls still work since `newFile` is optional and `undefined` short-circuits the new branch).

- [ ] **Step 5: Commit**

```bash
git add server/edit-history.mjs test/edit-history.test.js
git commit -m "feat(mcp): stage an optional second file into recordEdit's commit"
```

---

### Task 9: Wire `patcher.mjs` routing + `apply-edit-dispatcher.mjs` two-file write + `index-tools.mjs`

Full end-to-end wiring: `patcher.mjs` routes `extract-component` to `resolveComponentExtract`; the dispatcher writes `newFile` (OS-atomic create-if-absent) before splicing/writing the primary file, threads `hoistedProps`/`warnings` into the response `result`, and supports `dry_run`'s `newFile` preview; `index-tools.mjs`'s `onApplied` passes `newFile` through to `recordEdit`.

**Files:**
- Modify: `server/patcher.mjs`
- Modify: `server/apply-edit-dispatcher.mjs`
- Modify: `server/index-tools.mjs`
- Test: `tests/apply-edit-dispatcher-component-extract.test.ts`

**Interfaces:**
- Consumes: `resolveComponentExtract` (Task 6, final form); `recordEdit` with `newFile` (Task 8); `createEditPreviewContent` with `newFile` (Task 7).
- Produces: `applyEdit(projectRoot, edit, opts)` end-to-end support for `op: "extract-component"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/apply-edit-dispatcher-component-extract.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "@astrojs/compiler";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { fileVersion } from "../server/file-version.mjs";

const PAGE = `---\ninterface Props { title: string; }\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero">\n    <h1>{title}</h1>\n  </div>\n</main>\n`;

function parseContent(response) {
  return JSON.parse(response.content[0].text);
}

async function nodeIndex(source) {
  const { ast } = await parse(source, { position: true });
  return buildTemplateNodeIndex(ast, source);
}

describe("applyEdit — extract-component", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-aed-ext-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), PAGE);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function findDiv() {
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    return byId.get(main.childIds[0]);
  }

  it("writes both files, commits once, and returns componentPath/hoistedProps/warnings in result", async () => {
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
    });

    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-applied");
    expect(body.result.componentPath).toBe("src/components/Hero.astro");
    expect(body.result.hoistedProps).toEqual(["title"]);
    expect(body.result.warnings).toEqual([]);
    expect(body.model).toBeDefined();
    expect(body.model.path).toBe("src/components/Page.astro");

    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(true);
    const newFileOnDisk = readFileSync(join(tmpDir, "src", "components", "Hero.astro"), "utf-8");
    expect(newFileOnDisk).toContain("<h1>{title}</h1>");
    const originalOnDisk = readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8");
    expect(originalOnDisk).toContain("<Hero title={title} />");
  });

  it("refuses exists without writing anything when newComponentPath is already taken", async () => {
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), "<p>taken</p>\n");
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
    });

    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("exists");
    const originalOnDisk = readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8");
    expect(originalOnDisk).toBe(PAGE); // untouched
  });

  it("dry_run returns both previews and writes neither file", async () => {
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
      dry_run: true,
    });

    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-preview");
    expect(body.newFile.path).toBe("src/components/Hero.astro");
    expect(body.newFile.after).toContain("<h1>{title}</h1>");
    expect(body.after).toContain("<Hero title={title} />");
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(false);
    expect(readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8")).toBe(PAGE);
  });

  it("commits both files in one hidden-branch commit and undo_edit reverts both", async () => {
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "--initial-branch=main", tmpDir], { stdio: "ignore" });
    execFileSync("git", ["-C", tmpDir, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", tmpDir, "config", "user.name", "T"]);
    execFileSync("git", ["-C", tmpDir, "add", "-A"]);
    execFileSync("git", ["-C", tmpDir, "commit", "-m", "initial"]);

    const { recordEdit } = await import("../server/edit-history.mjs");
    const { undoEdit } = await import("../server/undo-edit.mjs");
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(
      tmpDir,
      {
        id: "1",
        path: "src/components/Page.astro",
        op: "extract-component",
        component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
      },
      { onApplied: ({ file, range, newFile }) => recordEdit(tmpDir, { file, range, newFile, message: `extract ${file}` }) },
    );
    const body = parseContent(response);
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(true);

    const undone = await undoEdit(tmpDir, {});
    expect(undone.status).toBe("undone");
    expect(readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8")).toBe(PAGE);
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(false);
  });

  it("re-checks staleness after the resolver's async gap, refusing a concurrent write race", async () => {
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const editPromise = applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
    });

    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), PAGE.replace("Welcome", "Renamed").replace("{title}", "{title} "));

    const response = await editPromise;
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("stale");
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/apply-edit-dispatcher-component-extract.test.ts`
Expected: FAIL — `resolve()` doesn't route `extract-component` yet, so every case gets a generic `no-match` refusal instead of the expected behavior.

- [ ] **Step 3: Implement**

In `server/patcher.mjs`, add the import and routing branch:

```js
import { resolveComponentExtract } from "./component-extract-edit.mjs";
```

```js
import { COMPONENT_STYLE_OPS, COMPONENT_STRUCTURE_OPS, COMPONENT_FRONTMATTER_OPS, COMPONENT_EXTRACT_OPS } from "./apply-edit-schema.mjs";
```

Inside `resolve()`, add the branch right after the `COMPONENT_FRONTMATTER_OPS` check:

```js
  if (COMPONENT_FRONTMATTER_OPS.has(edit.op)) {
    return resolveComponentFrontmatter(projectRoot, edit);
  }
  if (COMPONENT_EXTRACT_OPS.has(edit.op)) {
    return resolveComponentExtract(projectRoot, edit);
  }
```

In `server/index-tools.mjs`, update the `onApplied` wiring:

```js
  server.tool(
    "apply_edit",
    "Apply an edit to the underlying source for a previewed page element. The selector is the structured ElementInfo payload built by the WKWebView overlay; the server resolves it via selector.mjs and patches the matching source file. Successful edits are also committed onto the hidden anglesite/edits branch for per-edit undo.",
    applyEditInputShape,
    async (input) =>
      applyEdit(projectRoot, input, {
        onApplied: ({ file, range, newFile }) =>
          recordEdit(projectRoot, { file, range, newFile, message: `anglesite: edit ${file}` }),
      }),
  );
```

In `server/apply-edit-dispatcher.mjs`, update the JSDoc `@param` for `opts.onApplied` to include `newFile`:

```js
 * @param {{ onApplied?: (info: {file:string, range:{start:number,end:number}, projectRoot:string, newFile?:{path:string}}) => Promise<string|undefined> | string | undefined }} [opts]
```

Replace the tail of `applyEdit` (from `const next = spliceSource(source, range, replacement);` through the final `return applied(...)`) with:

```js
  const next = spliceSource(source, range, replacement);

  if (edit.dry_run) {
    const { before, after } = windowAround(source, next);
    const newFilePreview = resolution.newFile ? { path: resolution.newFile.path, after: resolution.newFile.content } : undefined;
    return preview(edit.id, file, range, edit.op, before, after, newFilePreview);
  }

  if (resolution.newFile) {
    const absNewPath = join(projectRoot, resolution.newFile.path);
    try {
      mkdirSync(dirname(absNewPath), { recursive: true });
      writeFileSync(absNewPath, resolution.newFile.content, { encoding: "utf-8", flag: "wx" });
    } catch (err) {
      if (err.code === "EEXIST") return failed(edit.id, "exists", `${resolution.newFile.path} already exists`);
      return failed(edit.id, "write-failed", `${resolution.newFile.path}: ${err.message}`);
    }
  }

  try {
    atomicWrite(absPath, next);
  } catch (err) {
    return failed(edit.id, "write-failed", `${file}: ${err.message}`);
  }

  let commit;
  if (opts.onApplied) {
    try {
      commit = await opts.onApplied({
        file,
        range,
        projectRoot,
        newFile: resolution.newFile ? { path: resolution.newFile.path } : undefined,
      });
    } catch (err) {
      commit = undefined;
    }
  }

  let model;
  if (COMPONENT_OPS.has(edit.op)) {
    try {
      model = await buildComponentModel(projectRoot, edit.component.path);
    } catch {
      model = undefined;
    }
  }

  const extractResult = edit.op === "extract-component"
    ? { componentPath: resolution.newFile?.path, hoistedProps: resolution.hoistedProps ?? [], warnings: resolution.warnings ?? [] }
    : undefined;

  return applied(
    edit.id,
    file,
    range,
    commit,
    imageResult ? { src: imageResult.src, srcset: imageResult.srcset } : extractResult,
    model,
  );
```

Update the `preview` helper's signature to accept and forward the optional `newFile` (it already just forwards to `createEditPreviewContent`, which Task 7 updated):

```js
function preview(id, file, range, op, before, after, newFile) {
  return { content: [createEditPreviewContent(id, file, range, op, before, after, newFile)] };
}
```

`mkdirSync` and `dirname` are already imported in `apply-edit-dispatcher.mjs` (used by `processImageDrop`); no new imports needed there beyond the `COMPONENT_OPS`-adjacent ones already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/apply-edit-dispatcher-component-extract.test.ts`
Expected: PASS (5 tests)

Then run the full suite to confirm no regressions across every other op:

Run: `npx vitest run`
Expected: PASS — every existing test plus all new ones from Tasks 1–9.

- [ ] **Step 5: Commit**

```bash
git add server/patcher.mjs server/apply-edit-dispatcher.mjs server/index-tools.mjs tests/apply-edit-dispatcher-component-extract.test.ts
git commit -m "feat(mcp): wire extract-component end to end through apply_edit"
```

---

### Task 10: CHANGELOG entry, version bump, full verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`, `.claude-plugin/plugin.json`, `template/package.json` (via `bin/release.ts` — do not hand-edit versions)

- [ ] **Step 1: Add the CHANGELOG entry**

Add a new `## [Unreleased]` (or the next version, per `bin/release.ts`'s convention — check `CHANGELOG.md`'s current top entry first) section at the top of `CHANGELOG.md`, above the existing `## [1.6.0]` entry:

```markdown
## [Unreleased]

### Added
- `apply_edit` gains `extract-component` — the first two-file component op —
  for the Component Editor's "Extract into Component…" gesture (Slice 5).
  Carves a `get_component_model` outline subtree (element/component/slot
  only) into a new `.astro` file under `src/components/`, hoists the
  original component's own declared Props that the subtree bare-referenced,
  migrates simple-selector scoped-style rules that exclusively target the
  extracted markup (reporting non-blocking `warnings` for anything shared or
  too complex to analyze automatically), and replaces the extracted markup
  with a self-closing instance + import. Lands both files in one hidden
  `anglesite/edits` branch commit, so `undo_edit` reverts both together.
```

- [ ] **Step 2: Run the version bump**

Run: `npx tsx bin/release.ts minor` (or whatever bump level the maintainer chooses — this is a new capability, not a breaking change, so `minor` per semver and this project's existing pattern of `minor` bumps for new ops in the 1.5.0/1.6.0 CHANGELOG entries read during planning)
Expected: `package.json`, `.claude-plugin/plugin.json`, `template/package.json` versions bumped in lockstep; a new git tag created.

- [ ] **Step 3: Run the full test suite one more time post-bump**

Run: `npx vitest run`
Expected: PASS — version bump touches no test-covered logic, this is a final confirmation nothing else drifted.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md package.json .claude-plugin/plugin.json template/package.json
git commit -m "chore: release extract-component (Component Editor Slice 5, plugin side)"
```

(If `bin/release.ts` already created a commit and tag as part of Step 2, verify with `git log --oneline -3` and `git tag --points-at HEAD` instead of creating a duplicate commit — follow whatever `bin/release.ts`'s actual behavior is, per `docs/dev/` release documentation.)

---

## Post-plan note (not a task): Anglesite-app paired PR

This plan covers the plugin side only. Per spec §7 and this project's established Slice 4 pattern (PR #418 / Anglesite-app#494), a **separate paired PR in `Anglesite/Anglesite-app`** is needed for: the "Extract into Component…" trigger, the name-prompt dialog, `dry_run` preview wiring in the app's UI, and `result.warnings`/`hoistedProps` surfacing. That work is out of scope here and should reference this plan's commit range once merged.
