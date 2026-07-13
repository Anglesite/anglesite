// Builds a structured, read-only model of one .astro component for the
// Component Editor (spec: Anglesite-app docs/superpowers/specs/
// 2026-07-05-component-editor-design.md §2.2).
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { parse } from "@astrojs/compiler";
import { parseProps } from "./props-interface.mjs";
import { fileVersion } from "./file-version.mjs";
import { indexCssRules } from "./css-rule-index.mjs";
import { buildTemplateNodeIndex } from "./component-node-index.mjs";

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

  const topLevel = ast.children ?? [];
  const { byId, rootId } = buildTemplateNodeIndex(ast, source);
  const template = toPublicNode(byId, rootId);

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

function toPublicNode(byId, id) {
  const r = byId.get(id);
  const node = {
    id: r.id,
    kind: r.kind,
    tag: r.tag,
    attrs: r.attrs.map(({ name, value }) => ({ name, value })),
    span: r.span,
    loc: r.loc,
    children: r.childIds.map((cid) => toPublicNode(byId, cid)),
  };
  if (r.text !== undefined) node.text = r.text;
  return node;
}
