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

// Detects an existing frontmatter block via indexOf rather than a regex requiring two
// independently-matched newlines — the regex approach fails to match the minimal
// empty-body shape `"---\n---\n"` (no blank body line between fences), which caused a
// second frontmatter block to be prepended in front of the existing one, corrupting the
// file. Mirrors the already-correct `findFrontmatterEnd` pattern in server/patcher.mjs.
function findFrontmatterBody(source) {
  if (!source.startsWith("---")) return null;
  const afterOpen = source.indexOf("\n", 3);
  if (afterOpen === -1) return null;
  const bodyStart = afterOpen + 1;
  const closeIdx = source.indexOf("\n---", 3);
  if (closeIdx === -1) return null;
  return { bodyStart, bodyEnd: closeIdx };
}

function rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath) {
  const specifier = importSpecifier(relPath, newComponentPath);
  const fm = findFrontmatterBody(afterNode);
  if (fm) {
    const fmBody = afterNode.slice(fm.bodyStart, fm.bodyEnd);
    const { source: newFmBody } = ensureImport(fmBody, { localName: componentName, specifier });
    return afterNode.slice(0, fm.bodyStart) + newFmBody + afterNode.slice(fm.bodyStart + fmBody.length);
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
  const componentName = basename(newComponentPath, ".astro");
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(componentName)) {
    return refuse("invalid-input", `newComponentPath's basename must be a capitalized component identifier: ${componentName}`);
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
