import { readFileSync, existsSync } from "node:fs";
import { join, normalize, basename, dirname, sep } from "node:path";
import { parse } from "@astrojs/compiler";
import { fileVersion } from "./file-version.mjs";
import { buildTemplateNodeIndex } from "./component-node-index.mjs";
import { resolveAllSpans, SpanResolutionError, importSpecifier, collectComponentTags } from "./component-structure-edit.mjs";
import { ensureImport, parseImports, pruneImportIfUnused } from "./frontmatter-imports.mjs";
import { parseProps, generatePropsInterface, generatePropsDestructure } from "./props-interface.mjs";

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

// Re-bases a relative import specifier from the ORIGINAL file's directory to a
// project-relative path, so it can be re-expressed relative to the NEW file's own
// directory below (via importSpecifier). E.g. from "src/components/sections/Page.astro"
// resolving specifier "../Badge.astro" yields "src/components/Badge.astro".
function resolveImportTargetPath(originalRelPath, specifier) {
  const abs = normalize(join(dirname(originalRelPath), specifier));
  return abs.split(sep).join("/");
}

// Import lines for any nested component(s) carried into the extracted subtree — copied
// from the original file's frontmatter and re-based to the new file's own directory. A
// moved name with no matching import in the original frontmatter (e.g. never actually
// declared) is silently skipped rather than fabricated.
function importLinesForNewFile(originalFmBody, movedComponentNames, relPath, newComponentPath) {
  const origImports = parseImports(originalFmBody ?? "");
  return [...new Set(movedComponentNames)]
    .map((name) => origImports.find((i) => i.localName === name))
    .filter(Boolean)
    .map((imp) => {
      const targetRelPath = resolveImportTargetPath(relPath, imp.specifier);
      return `import ${imp.localName} from "${importSpecifier(newComponentPath, targetRelPath)}";\n`;
    })
    .join("");
}

// `findFrontmatterBody` (not the FRONTMATTER_RE regex) is used here deliberately — see its
// file-level comment above: the regex fails to match the minimal empty-body frontmatter
// shape "---\n---\n", which would otherwise cause a second frontmatter block to be
// prepended via the no-frontmatter fallback below, corrupting the file.
function rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath, movedComponentNames) {
  const specifier = importSpecifier(relPath, newComponentPath);
  const fm = findFrontmatterBody(afterNode);
  const ensureAndPrune = (fmBody) => {
    let body = ensureImport(fmBody, { localName: componentName, specifier }).source;
    for (const name of movedComponentNames) {
      body = pruneImportIfUnused(body, afterNode, name).source;
    }
    return body;
  };
  if (fm) {
    const fmBody = afterNode.slice(fm.bodyStart, fm.bodyEnd);
    const newFmBody = ensureAndPrune(fmBody);
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
  const { source, byId, rootId, astById } = loaded;

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

  const origFmMatch = source.match(FRONTMATTER_RE);
  const originalProps = origFmMatch ? parseProps(origFmMatch[2]) : [];
  const subtreeIds = collectSubtreeIds(byId, nodeId);
  const hoistedPropRecords = findHoistCandidates(byId, astById, subtreeIds, spans, source, originalProps);
  const movedComponentNames = collectComponentTags(byId, nodeId);

  const instanceAttrs = hoistedPropRecords.map((p) => ` ${p.name}={${p.name}}`).join("");
  const instanceTag = `<${componentName}${instanceAttrs} />`;
  const afterNode = source.slice(0, nodeSpan[0]) + instanceTag + source.slice(nodeSpan[1]);
  const afterImport = rewriteOriginalFrontmatter(afterNode, relPath, componentName, newComponentPath, movedComponentNames);

  const importLines = importLinesForNewFile(origFmMatch ? origFmMatch[2] : "", movedComponentNames, relPath, newComponentPath);
  const propsInterface = generatePropsInterface(hoistedPropRecords);
  const propsDestructure = generatePropsDestructure(hoistedPropRecords);
  const fmParts = [importLines ? importLines.trimEnd() : null, propsInterface, propsDestructure].filter(Boolean);
  const newFm = fmParts.length ? `---\n${fmParts.join("\n")}\n---\n` : "";

  return {
    file: relPath,
    range: { start: 0, end: source.length },
    replacement: afterImport,
    newFile: { path: newComponentPath, content: `${newFm}${subtreeText}\n` },
    hoistedProps: hoistedPropRecords.map((p) => p.name),
    warnings: [],
  };
}
