import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { parse } from "@astrojs/compiler";
import { fileVersion } from "./file-version.mjs";
import { buildLineStarts, offsetFromLineColumn } from "./component-node-index.mjs";
import { generatePropsInterface, generatePropsDestructure } from "./props-interface.mjs";
import { parseImports } from "./frontmatter-imports.mjs";

/**
 * Write-side resolver for the two Component Editor "Props & code" ops
 * (set-props-interface, set-script-zone). Mirrors component-style-edit.mjs's
 * shape: read fresh from disk, check `baseVersion`, turn the requested op
 * into a precise byte-range splice.
 */

function refuse(reason, detail) {
  return { refused: true, reason, detail };
}

function validPath(relPath) {
  return typeof relPath === "string" && relPath.endsWith(".astro") && !normalize(relPath).startsWith("..") && !relPath.startsWith("/");
}

// Matches the block `parseProps` (props-interface.mjs) locates for reading.
const PROPS_INTERFACE_RE = /(?:interface\s+Props|type\s+Props\s*=)\s*\{[\s\S]*?\n\}/;
const PROPS_DESTRUCTURE_RE = /const\s*\{[\s\S]*?\}\s*=\s*Astro\.props;?/;
const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;

export async function resolveComponentFrontmatter(projectRoot, edit) {
  const { component } = edit;
  if (!component || typeof component !== "object") {
    return refuse("invalid-input", "component payload is required for this op");
  }
  const { path: relPath, baseVersion } = component;
  if (!validPath(relPath)) {
    return refuse("invalid-input", `not a project-relative .astro path: ${relPath}`);
  }

  const absPath = join(projectRoot, relPath);
  let source;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch (err) {
    return refuse("read-failed", `read ${relPath}: ${err.message}`);
  }

  if (fileVersion(source) !== baseVersion) {
    return refuse("stale", `${relPath} changed since the model was fetched`);
  }

  switch (edit.op) {
    case "set-props-interface":
      return applySetPropsInterface(relPath, source, component);
    case "set-script-zone":
      return applySetScriptZone(relPath, source, component);
    default:
      return refuse("invalid-input", `unsupported component-frontmatter op: ${edit.op}`);
  }
}

function applySetPropsInterface(file, source, component) {
  const { props } = component;
  if (!Array.isArray(props)) {
    return refuse("invalid-input", "set-props-interface requires component.props (array)");
  }
  for (const p of props) {
    if (!p || typeof p !== "object" || typeof p.name !== "string" || typeof p.type !== "string" || typeof p.optional !== "boolean") {
      return refuse("invalid-input", "each prop requires name (string), type (string), and optional (boolean)");
    }
  }

  const newInterface = generatePropsInterface(props);
  const newDestructure = generatePropsDestructure(props);
  const fmMatch = source.match(FRONTMATTER_RE);

  if (!fmMatch) {
    if (!newInterface) {
      return refuse("no-match", "component has no frontmatter and no props to add");
    }
    const block = [newInterface, newDestructure].filter(Boolean).join("\n");
    return { file, range: { start: 0, end: 0 }, replacement: `---\n${block}\n---\n` };
  }

  const [, open, fmBody] = fmMatch;
  const fmBodyStart = fmMatch.index + open.length;

  let newBody = replacePropsInterfaceBlock(fmBody, newInterface);
  newBody = replacePropsDestructure(newBody, newDestructure);

  return { file, range: { start: fmBodyStart, end: fmBodyStart + fmBody.length }, replacement: newBody };
}

function replacePropsInterfaceBlock(fmBody, newInterface) {
  const match = fmBody.match(PROPS_INTERFACE_RE);
  if (match) {
    if (!newInterface) {
      let end = match.index + match[0].length;
      if (fmBody[end] === "\n") end++;
      return fmBody.slice(0, match.index) + fmBody.slice(end);
    }
    return fmBody.slice(0, match.index) + newInterface + fmBody.slice(match.index + match[0].length);
  }
  if (!newInterface) return fmBody;
  // No existing interface — insert after the last import (mirrors ensureImport's
  // placement convention), or at the top of the frontmatter body if there are none.
  const imports = parseImports(fmBody);
  const insertAt = imports.length > 0 ? imports[imports.length - 1].span[1] : fmBody.startsWith("\n") ? 1 : 0;
  return fmBody.slice(0, insertAt) + newInterface + "\n" + fmBody.slice(insertAt);
}

function replacePropsDestructure(fmBody, newDestructure) {
  const match = fmBody.match(PROPS_DESTRUCTURE_RE);
  if (match) {
    if (!newDestructure) {
      let end = match.index + match[0].length;
      if (fmBody[end] === "\n") end++;
      return fmBody.slice(0, match.index) + fmBody.slice(end);
    }
    return fmBody.slice(0, match.index) + newDestructure + fmBody.slice(match.index + match[0].length);
  }
  if (!newDestructure) return fmBody;
  // No existing destructure — insert right after the Props interface block when present
  // (the natural place a hand-written destructure would sit), else at the end of the body.
  const ifaceMatch = fmBody.match(PROPS_INTERFACE_RE);
  if (ifaceMatch) {
    let insertAt = ifaceMatch.index + ifaceMatch[0].length;
    if (fmBody[insertAt] === "\n") insertAt++;
    return fmBody.slice(0, insertAt) + newDestructure + "\n" + fmBody.slice(insertAt);
  }
  const trimmedEnd = fmBody.replace(/\s+$/, "").length;
  return fmBody.slice(0, trimmedEnd) + (trimmedEnd > 0 ? "\n" : "") + newDestructure + fmBody.slice(trimmedEnd);
}

function applySetScriptZone(file, source, component) {
  const { zone, source: newSource } = component;
  if (zone !== "frontmatter" && zone !== "client") {
    return refuse("invalid-input", 'set-script-zone requires component.zone to be "frontmatter" or "client"');
  }
  if (typeof newSource !== "string") {
    return refuse("invalid-input", "set-script-zone requires component.source (string)");
  }
  return zone === "frontmatter" ? applySetFrontmatterZone(file, source, newSource) : applySetClientScriptZone(file, source, newSource);
}

function applySetFrontmatterZone(file, source, newSource) {
  const fmMatch = source.match(FRONTMATTER_RE);
  if (!fmMatch) {
    return { file, range: { start: 0, end: 0 }, replacement: `---\n${newSource}\n---\n` };
  }
  const [, open, fmBody] = fmMatch;
  const fmBodyStart = fmMatch.index + open.length;
  return { file, range: { start: fmBodyStart, end: fmBodyStart + fmBody.length }, replacement: newSource };
}

async function applySetClientScriptZone(file, source, newSource) {
  let ast;
  try {
    ({ ast } = await parse(source, { position: true }));
  } catch (err) {
    return refuse("parse-failed", `parse ${file}: ${err.message}`);
  }
  const lineStarts = buildLineStarts(source);
  const scriptElements = [];
  collectScriptElements(ast, scriptElements);
  const textNode = scriptElements.map((el) => (el.children ?? []).find((c) => c.type === "text")).find((t) => t?.value);

  if (textNode) {
    const start = offsetFromLineColumn(lineStarts, textNode.position?.start);
    const end = offsetFromLineColumn(lineStarts, textNode.position?.end);
    if (start == null || end == null) {
      return refuse("no-match", "could not resolve the client script's source span");
    }
    return { file, range: { start, end }, replacement: newSource };
  }

  // No existing non-empty client script — append a new <script> block, mirroring
  // add-style-rule's "create the container if absent" fallback in component-style-edit.mjs.
  return { file, range: { start: source.length, end: source.length }, replacement: `\n<script>\n${newSource}\n</script>\n` };
}

function collectScriptElements(node, out) {
  if (node.type === "element" && node.name === "script") out.push(node);
  for (const child of node.children ?? []) collectScriptElements(child, out);
}
