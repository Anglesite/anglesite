// Builds a structured, read-only model of one .astro component for the
// Component Editor (spec: Anglesite-app docs/superpowers/specs/
// 2026-07-05-component-editor-design.md §2.2).
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { parse } from "@astrojs/compiler";
import { parseProps } from "./props-interface.mjs";
import { fileVersion } from "./file-version.mjs";
import { indexCssRules } from "./css-rule-index.mjs";
import { buildTemplateNodeIndex, buildLineStarts, offsetFromLineColumn } from "./component-node-index.mjs";

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

  // See the offset-encoding note in component-node-index.mjs: @astrojs/compiler's
  // `position.*.offset` is a UTF-8 byte offset, not a JS-string index, so it's never
  // consulted here either — spans below are derived from the (reliable) line/column.
  const lineStarts = buildLineStarts(source);

  const styleElements = [];
  collectElements(ast, "style", styleElements);
  const styles = styleElements.flatMap((el) => extractRules(el, lineStarts));

  const fmNode = topLevel.find((n) => n.type === "frontmatter");
  const frontmatter = fmNode
    ? {
        source: fmNode.value ?? "",
        span: [offsetFromLineColumn(lineStarts, fmNode.position?.start), offsetFromLineColumn(lineStarts, fmNode.position?.end)],
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
        span: [
          offsetFromLineColumn(lineStarts, scriptText.position?.start),
          offsetFromLineColumn(lineStarts, scriptText.position?.end),
        ],
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

export function collectElements(node, name, out) {
  if (node.type === "element" && node.name === name) out.push(node);
  for (const child of node.children ?? []) collectElements(child, name, out);
}

function extractRules(styleElement, lineStarts) {
  return indexCssRules(styleElement, lineStarts).map(({ selector, media, span, declarations }) => ({
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
