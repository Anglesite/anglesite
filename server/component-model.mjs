// Builds a structured, read-only model of one .astro component for the
// Component Editor (spec: Anglesite-app docs/superpowers/specs/
// 2026-07-05-component-editor-design.md §2.2).
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { parse } from "@astrojs/compiler";
import { parseProps } from "./props-interface.mjs";
import { fileVersion } from "./file-version.mjs";
import { indexCssRules } from "./css-rule-index.mjs";

export class ComponentModelError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export async function buildComponentModel(projectRoot, relPath) {
  if (
    typeof relPath !== "string" ||
    !relPath.endsWith(".astro") ||
    normalize(relPath).startsWith("..") ||
    relPath.startsWith("/")
  ) {
    throw new ComponentModelError("invalid-input", `not a project-relative .astro path: ${relPath}`);
  }
  const absPath = join(projectRoot, relPath);
  let source;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch (err) {
    throw new ComponentModelError("read-failed", `read ${relPath}: ${err.message}`);
  }
  let ast;
  try {
    ({ ast } = await parse(source, { position: true }));
  } catch (err) {
    throw new ComponentModelError("parse-failed", `parse ${relPath}: ${err.message}`);
  }

  const builder = new NodeBuilder();
  const topLevel = ast.children ?? [];
  const template = {
    id: builder.nextId(),
    kind: "fragment",
    tag: null,
    attrs: [],
    span: [0, source.length],
    loc: null,
    children: topLevel
      .filter((n) => !isZoneNode(n))
      .map((n) => builder.toNode(n))
      .filter(Boolean),
  };

  const styleElements = [];
  collectElements(ast, "style", styleElements);
  const styles = styleElements.flatMap((el) => extractRules(el));

  const fmNode = topLevel.find((n) => n.type === "frontmatter");
  const frontmatter = fmNode
    ? {
        source: fmNode.value ?? "",
        span: [fmNode.position?.start?.offset ?? null, fmNode.position?.end?.offset ?? null],
        props: parseProps(fmNode.value ?? ""),
      }
    : null;

  const scriptElements = [];
  collectElements(ast, "script", scriptElements);
  const scriptText = scriptElements
    .map((el) => (el.children ?? []).find((c) => c.type === "text"))
    .find((t) => t?.value);
  const clientScript = scriptText
    ? {
        source: scriptText.value,
        span: [scriptText.position?.start?.offset ?? null, scriptText.position?.end?.offset ?? null],
      }
    : null;

  return {
    version: fileVersion(source),
    path: relPath,
    template,
    frontmatter,
    styles,
    clientScript,
  };
}

function collectElements(node, name, out) {
  if (node.type === "element" && node.name === name) out.push(node);
  for (const child of node.children ?? []) collectElements(child, name, out);
}

function extractRules(styleElement) {
  return indexCssRules(styleElement).map(({ selector, media, span, declarations }) => ({
    selector,
    media,
    span,
    declarations,
  }));
}

// style/script/frontmatter are zones, not template nodes.
function isZoneNode(n) {
  return n.type === "frontmatter" || (n.type === "element" && (n.name === "style" || n.name === "script"));
}

// AST node types that represent real embedded JSX inside an expression's
// `children` (as opposed to "text" pseudo-nodes, which are raw JS source).
const JSX_CHILD_TYPES = new Set(["element", "component", "custom-element", "fragment"]);

class NodeBuilder {
  #next = 0;
  nextId() {
    return `n${this.#next++}`;
  }
  toNode(n) {
    switch (n.type) {
      case "element":
        return this.#make(n, n.name === "slot" ? "slot" : "element", n.name);
      case "component":
      case "custom-element":
        return this.#make(n, "component", n.name);
      case "fragment":
        return this.#make(n, "fragment", null);
      case "expression":
        // An expression's `children` mix raw JS source (as "text" pseudo-nodes,
        // e.g. "profile && (" ) with any JSX actually embedded in it (e.g. a
        // conditional root `{cond && (<el/>)}` or a mapped list). Only the
        // latter are real markup — walk those; drop the JS-source text.
        //
        // A two-branch conditional (`{cond ? <A/> : <B/>}`) surfaces both `<A>`
        // and `<B>` as siblings here even though only one renders at a time —
        // acceptable for a static outline/editor tree, but worth knowing if a
        // future consumer assumes every outline row is on the live page.
        return {
          ...this.#base(n),
          kind: "expression",
          tag: null,
          attrs: [],
          children: (n.children ?? [])
            .filter((c) => JSX_CHILD_TYPES.has(c.type))
            .map((c) => this.toNode(c))
            .filter(Boolean),
        };
      case "text": {
        const value = (n.value ?? "").trim();
        if (!value) return null;
        return { ...this.#base(n), kind: "text", tag: null, attrs: [], text: value.slice(0, 80), children: [] };
      }
      default:
        return null; // comment, doctype
    }
  }
  #make(n, kind, tag) {
    return {
      ...this.#base(n),
      kind,
      tag,
      attrs: (n.attributes ?? []).map((a) => ({ name: a.name, value: a.value ?? null })),
      children: (n.children ?? [])
        .filter((c) => !isZoneNode(c))
        .map((c) => this.toNode(c))
        .filter(Boolean),
    };
  }
  #base(n) {
    const start = n.position?.start;
    const end = n.position?.end;
    return {
      id: this.nextId(),
      span: [start?.offset ?? null, end?.offset ?? null],
      loc: start ? { line: start.line, column: start.column } : null,
    };
  }
}
