// Builds a structured, read-only model of one .astro component for the
// Component Editor (spec: Anglesite-app docs/superpowers/specs/
// 2026-07-05-component-editor-design.md §2.2).
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse } from "@astrojs/compiler";
import { parse as parseCss, generate, walk } from "css-tree";

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

  return {
    version: fileVersion(projectRoot, source),
    path: relPath,
    template,
    frontmatter: null, // Task 3
    styles,
    clientScript: null, // Task 3
  };
}

function collectElements(node, name, out) {
  if (node.type === "element" && node.name === name) out.push(node);
  for (const child of node.children ?? []) collectElements(child, name, out);
}

function extractRules(styleElement) {
  const textChild = (styleElement.children ?? []).find((c) => c.type === "text");
  if (!textChild?.value) return [];
  const baseOffset = textChild.position?.start?.offset ?? 0;
  let cssAst;
  try {
    cssAst = parseCss(textChild.value, {
      positions: true,
      parseValue: false,
      parseAtrulePrelude: false,
    });
  } catch {
    return []; // unparseable CSS: styles stay empty; template/props still usable
  }
  const rules = [];
  walk(cssAst, {
    visit: "Rule",
    enter(node) {
      const media =
        this.atrule && this.atrule.name === "media" && this.atrule.prelude
          ? generate(this.atrule.prelude).trim()
          : null;
      const declarations = [];
      node.block.children.forEach((decl) => {
        if (decl.type !== "Declaration") return;
        declarations.push({
          property: decl.property,
          value: generate(decl.value).trim(),
          span: cssSpan(decl.loc, baseOffset),
        });
      });
      rules.push({
        selector: generate(node.prelude),
        media,
        span: cssSpan(node.loc, baseOffset),
        declarations,
      });
    },
  });
  return rules;
}

function cssSpan(loc, baseOffset) {
  if (!loc) return [null, null];
  return [baseOffset + loc.start.offset, baseOffset + loc.end.offset];
}

// style/script/frontmatter are zones, not template nodes.
function isZoneNode(n) {
  return n.type === "frontmatter" || (n.type === "element" && (n.name === "style" || n.name === "script"));
}

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
      case "expression":
        return { ...this.#base(n), kind: "expression", tag: null, attrs: [], children: [] };
      case "text": {
        const value = (n.value ?? "").trim();
        if (!value) return null;
        return { ...this.#base(n), kind: "text", tag: null, attrs: [], text: value.slice(0, 80), children: [] };
      }
      default:
        return null; // comment, doctype, fragment wrappers
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

function fileVersion(projectRoot, source) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf-8" }).trim();
  } catch {
    return "sha256:" + createHash("sha256").update(source).digest("hex").slice(0, 12);
  }
}
