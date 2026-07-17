import { readFileSync, existsSync } from "node:fs";
import { join, normalize, dirname } from "node:path";
import { parse } from "@astrojs/compiler";
import { fileVersion } from "./file-version.mjs";
import { buildTemplateNodeIndex } from "./component-node-index.mjs";
import { ensureImport, parseImports } from "./frontmatter-imports.mjs";
import { generatePropsInterface, generatePropsDestructure } from "./props-interface.mjs";
import {
  resolveAllSpans,
  SpanResolutionError,
  escapeAttr,
  importSpecifier,
  collectComponentTags,
} from "./component-structure-edit.mjs";

/**
 * Write-side resolver for `extract-component` (Component Editor slice 5, Anglesite-app#495):
 * lifts a selected outline subtree out of an existing `.astro` component into a brand-new
 * `src/components/<newName>.astro` file, hoists "obvious" literal props, and replaces the
 * selection in the SOURCE file with an instance of the new component plus a matching import.
 *
 * Unlike every other component op (component-style-edit.mjs, component-structure-edit.mjs,
 * component-frontmatter-edit.mjs), this one touches TWO files. It returns a distinct shape —
 * `{ extract: true, newFile, original }` — instead of the single-file `{file, range,
 * replacement}` every other resolver returns; apply-edit-dispatcher.mjs branches on
 * `resolution.extract` to run the two-file write instead of the generic single-splice path. See
 * that file's `applyExtractComponent` for the write-order/rollback contract.
 *
 * Two design decisions worth calling out (also covered in the PR description):
 *
 * 1. Span discipline for the SUBTREE ROOT: like remove-node/insert-node/move-node, this NEVER
 *    trusts the extracted node's own `node.span` directly — it re-derives the true boundary via
 *    `resolveAllSpans`'s lexical walk (see component-structure-edit.mjs's file-level comment for
 *    why). Individual literal candidates WITHIN that already-verified boundary (attribute values,
 *    text-node content) DO use their own `attr.span`/`node.span` directly, matching the already-
 *    shipped `set-attr` resolver's precedent — the failure mode for a slightly-off literal span is
 *    "this one candidate doesn't get offered as a prop" (each is sanity-checked against its
 *    expected text before being trusted; see `collectCandidates`), never file corruption, so the
 *    stakes don't justify a second resolveAllSpans-grade walk for every attribute and text node.
 *
 * 2. Prop-hoisting heuristic: a literal is "obvious" enough to hoist only when its exact string
 *    value occurs exactly ONCE among all quoted-attribute-values and text-node contents in the
 *    subtree (kind: "quoted" per @astrojs/compiler's own attribute-kind enum — expression/
 *    shorthand/spread/template-literal attrs are never literals and are skipped outright; text
 *    nodes modeled by buildTemplateNodeIndex are, by construction, always static). Attribute
 *    props are named after the (camelCased, reserved-word-safe) attribute name; text props get a
 *    generic `text1`, `text2`, … sequence in document order. Every hoisted prop is `type:
 *    "string"` — no number/boolean inference (no prior art for it in this codebase, and the
 *    payoff isn't worth the complexity for a first cut). Name collisions get a numeric suffix.
 *
 * 3. Dynamic content is refused outright, not silently copied. `collectCandidates` already never
 *    offers an expression/dynamic-attribute as a HOISTABLE prop — but that alone isn't enough:
 *    without a separate check, anything that isn't specifically hoisted (including any
 *    `{expression}` — text interpolation, a dynamic attribute binding, a spread, a template
 *    literal) would still get copied byte-for-byte into the new file by `hoistProps`'s markup
 *    splice. Its referenced identifiers (frontmatter variables, props destructured from
 *    `Astro.props`, loop variables from an enclosing `.map()`, …) are NOT in scope in the new
 *    file, which only gets the hoisted-prop destructure — so the new file would fail to build.
 *    `findDynamicContent` walks the subtree up front and refuses with the same `dynamic-expression`
 *    reason `patcher.mjs`'s `resolveAstro` already uses for "can't safely act on dynamic content,"
 *    matching every sibling structural op's fail-closed convention rather than attempting to
 *    hoist expressions as pass-through props in this same change.
 */

function refuse(reason, detail) {
  return { refused: true, reason, detail };
}

function validPath(relPath) {
  return typeof relPath === "string" && relPath.endsWith(".astro") && !normalize(relPath).startsWith("..") && !relPath.startsWith("/");
}

// PascalCase only: this becomes both a JSX tag (Astro/JSX treats a lowercase tag as a native
// HTML element, never a component) and a frontmatter `import <Name> from "...";` local binding,
// so it has to be a valid bare identifier too.
const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

const VALID_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Reserved words that would make `const { <name> } = Astro.props;` (generatePropsDestructure's
// shorthand form) a syntax error if used as a destructured binding name. "class" and "for" are
// the realistic collisions (both extremely common HTML attribute names); the rest are included
// for completeness rather than because they're likely attribute names.
const RESERVED_WORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof",
  "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while",
  "with", "yield", "let", "static", "enum", "await", "implements", "interface", "package",
  "private", "protected", "public", "null", "true", "false",
]);

// Every @astrojs/compiler attribute kind OTHER than "quoted" (a plain string literal) and
// "empty" (a valueless boolean attribute like `disabled` — no referenced identifier at all) is
// dynamic: it either directly names a variable ("expression": `src={imageUrl}`, "shorthand":
// `{value}`), splices one in ("template-literal": `` `hi${x}` ``), or spreads a whole object
// ("spread": `{...rest}`). Any of these inside the extracted subtree references an identifier
// that won't exist in the new file — see `findDynamicContent`.
const DYNAMIC_ATTR_KINDS = new Set(["expression", "shorthand", "spread", "template-literal"]);

/**
 * True if the subtree rooted at `nodeId` contains ANY dynamic content: an "expression"-kind
 * node (text interpolation, `{items.map(...)}`, etc.) anywhere in the tree, or a dynamic-kind
 * attribute (see `DYNAMIC_ATTR_KINDS`) on any element/component descendant. Used to refuse the
 * whole op up front — see design decision 3 in the file header for why silently copying such
 * content into the new file (rather than refusing) would produce a file that fails to build.
 */
function findDynamicContent(byId, nodeId) {
  function visit(id) {
    const n = byId.get(id);
    if (!n) return false;
    if (n.kind === "expression") return true;
    if (n.kind === "element" || n.kind === "component") {
      if (n.attrs.some((attr) => DYNAMIC_ATTR_KINDS.has(attr.kind))) return true;
    }
    return n.childIds.some((childId) => visit(childId));
  }
  return visit(nodeId);
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
  const { byId, rootId } = buildTemplateNodeIndex(ast, source);
  return { source, ast, byId, rootId };
}

function camelizeAttrName(name) {
  const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  return RESERVED_WORDS.has(camel) ? `${camel}Value` : camel;
}

/**
 * Depth-first walk of the subtree rooted at `nodeId`, collecting literal-value candidates:
 * quoted attribute values (on element/component nodes — NOT slot, whose attrs like `name` are
 * structural) and text-node content. Each candidate's span comes directly from the model's own
 * `attr.span`/`node.span` (line/column-derived — see the file header for why that's trusted
 * here but not for the subtree root's own boundary) and is sanity-checked against the value it's
 * supposed to contain before being trusted; a mismatch just drops that one candidate rather than
 * risking a bad splice. Never descends into an "expression" node's children — content generated
 * inside a JS expression (e.g. `{items.map(i => <li>{i}</li>)}`) is per-iteration/dynamic, never
 * a simple hoistable literal.
 */
function collectCandidates(byId, nodeId, source, nodeSpan) {
  const candidates = [];

  function visit(id) {
    const n = byId.get(id);
    if (!n) return;
    if (n.kind === "expression") return;

    if (n.kind === "text") {
      const text = n.text; // trimmed by buildTemplateNodeIndex; may be silently truncated at 80 chars
      if (text && text.length < 80 && n.span[0] != null && n.span[1] != null) {
        const raw = source.slice(n.span[0], n.span[1]);
        const trimmed = raw.trim();
        if (trimmed === text) {
          const start = n.span[0] + (raw.length - raw.trimStart().length);
          const end = start + trimmed.length;
          if (start >= nodeSpan[0] && end <= nodeSpan[1]) {
            candidates.push({ value: text, kind: "text", span: [start, end] });
          }
        }
      }
    } else if (n.kind === "element" || n.kind === "component") {
      for (const attr of n.attrs) {
        if (attr.kind !== "quoted" || attr.value == null) continue;
        if (attr.span[0] == null || attr.span[1] == null) continue;
        if (attr.span[0] < nodeSpan[0] || attr.span[1] > nodeSpan[1]) continue;
        if (!source.slice(attr.span[0], attr.span[1]).startsWith(`${attr.name}=`)) continue;
        candidates.push({ value: attr.value, kind: "attr", attrName: attr.name, span: attr.span });
      }
    }

    for (const childId of n.childIds) visit(childId);
  }

  visit(nodeId);
  return candidates;
}

/**
 * From the candidate pool, keeps only values referenced exactly once, assigns each a prop name
 * (deduped against collisions), and produces: the new component's markup (literals replaced by
 * `{propName}` references), its `props` array (for props-interface.mjs codegen), and the
 * `instanceAttrs` the SOURCE file's replacement instance tag should carry (the original literal
 * values, passed straight through so the extraction is behavior-preserving by default).
 */
function hoistProps(byId, nodeId, source, nodeSpan) {
  const candidates = collectCandidates(byId, nodeId, source, nodeSpan);

  const countByValue = new Map();
  for (const c of candidates) countByValue.set(c.value, (countByValue.get(c.value) ?? 0) + 1);
  const hoistable = candidates.filter((c) => countByValue.get(c.value) === 1).sort((a, b) => a.span[0] - b.span[0]);

  const usedNames = new Set();
  function reserveName(base) {
    let name = base;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${base}${n}`;
      n++;
    }
    usedNames.add(name);
    return name;
  }

  let textCounter = 0;
  const props = [];
  const instanceAttrs = [];
  const replacements = [];

  for (const c of hoistable) {
    let propName;
    let replacementText;
    if (c.kind === "attr") {
      const candidateName = camelizeAttrName(c.attrName);
      if (!VALID_IDENTIFIER_RE.test(candidateName)) continue; // can't name a prop after this attr — leave it as a literal
      propName = reserveName(candidateName);
      replacementText = `${c.attrName}={${propName}}`;
    } else {
      textCounter++;
      propName = reserveName(`text${textCounter}`);
      replacementText = `{${propName}}`;
    }
    props.push({ name: propName, type: "string", optional: false, default: null });
    instanceAttrs.push({ name: propName, value: c.value });
    replacements.push({ span: c.span, text: replacementText });
  }

  let cursor = nodeSpan[0];
  let markup = "";
  for (const r of replacements) {
    markup += source.slice(cursor, r.span[0]);
    markup += r.text;
    cursor = r.span[1];
  }
  markup += source.slice(cursor, nodeSpan[1]);

  return { markup, props, instanceAttrs };
}

/**
 * For every component-kind tag used inside the extracted subtree (via `collectComponentTags`,
 * the same walk `remove-node` uses for import pruning), find its default import in the SOURCE
 * file's frontmatter and carry it into the new file — re-expressed as a specifier relative to
 * the NEW file's own location when the original specifier was itself relative (the two files
 * don't generally live in the same directory-depth relationship the original specifier
 * assumed); a bare package specifier (`"some-astro-lib/Icon.astro"`) or a tsconfig path alias
 * (`"@components/Button.astro"`) is passed through UNCHANGED instead — rewriting those through
 * `dirname(relPath)` would silently reinterpret them as project-relative paths and point
 * nowhere. Returns the joined `import X from "...";` lines (or "" if nothing to carry).
 */
function carriedImportLines(byId, nodeId, source, relPath, newRelPath) {
  const usedTags = [...new Set(collectComponentTags(byId, nodeId))];
  if (usedTags.length === 0) return "";

  const fmMatch = source.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) return "";
  const sourceImports = parseImports(fmMatch[2]);

  const lines = [];
  for (const tag of usedTags) {
    const imp = sourceImports.find((i) => i.localName === tag);
    if (!imp) continue; // plain custom element, or the source file's own import is missing/broken
    if (!imp.specifier.startsWith(".")) {
      lines.push(`import ${tag} from "${imp.specifier}";`);
      continue;
    }
    const importedProjectRelPath = normalize(join(dirname(relPath), imp.specifier));
    lines.push(`import ${tag} from "${importSpecifier(newRelPath, importedProjectRelPath)}";`);
  }
  return lines.join("\n");
}

export async function resolveComponentExtract(projectRoot, edit) {
  const { component } = edit;
  if (!component || typeof component !== "object") {
    return refuse("invalid-input", "component payload is required for this op");
  }
  const { path: relPath, baseVersion, nodeId, newName } = component;
  if (!validPath(relPath)) {
    return refuse("invalid-input", `not a project-relative .astro path: ${relPath}`);
  }
  if (typeof nodeId !== "string") {
    return refuse("invalid-input", "extract-component requires component.nodeId");
  }
  if (typeof newName !== "string" || !COMPONENT_NAME_RE.test(newName)) {
    return refuse("invalid-input", 'extract-component requires component.newName as a PascalCase identifier, e.g. "CardTitle"');
  }

  const loaded = await loadFresh(projectRoot, relPath, baseVersion);
  if (loaded.error) return loaded.error;
  const { source, byId, rootId } = loaded;

  const node = byId.get(nodeId);
  if (!node) return refuse("no-match", "no node found at the given id — the file may have changed");
  if (node.parentId === null) return refuse("invalid-input", "cannot extract the component's own root");
  if (node.kind !== "element" && node.kind !== "component") {
    return refuse("invalid-input", `extract-component requires an element or component node, got kind=${node.kind}`);
  }
  if (findDynamicContent(byId, nodeId)) {
    return refuse(
      "dynamic-expression",
      "extract-component cannot safely extract a subtree containing dynamic content ({expression} interpolation, a dynamic attribute binding, a spread, or a template literal) — the identifiers it references would not be in scope in the new file",
    );
  }

  const newRelPath = `src/components/${newName}.astro`;
  if (newRelPath === relPath) {
    return refuse("invalid-input", "newName must not match the source component's own file");
  }
  if (existsSync(join(projectRoot, newRelPath))) {
    return refuse("already-exists", `${newRelPath} already exists`);
  }

  // `ensureImport` (frontmatter-imports.mjs) dedups by SPECIFIER, not by local name — it would
  // happily append a SECOND `import <newName> from "./<newName>.astro";` alongside an existing,
  // unrelated `import <newName> from "<somewhere else>";`, producing a duplicate-declaration
  // syntax error in the source file at build time. Refuse up front instead of generating broken
  // output; the newRelPath specifier itself can never already be bound to a DIFFERENT specifier
  // for the same local name, since `existsSync` above already proved that file doesn't exist yet.
  const sourceFmMatch = source.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (sourceFmMatch) {
    const collision = parseImports(sourceFmMatch[2]).find((i) => i.localName === newName);
    if (collision) {
      return refuse(
        "invalid-input",
        `newName "${newName}" collides with an existing import of a different component ("${collision.specifier}") in ${relPath}`,
      );
    }
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

  const { markup, props, instanceAttrs } = hoistProps(byId, nodeId, source, nodeSpan);

  // Carry over imports for any component-kind descendants used INSIDE the extracted subtree
  // (e.g. extracting a wrapper that itself renders `<Badge ... />`) — without this the new file
  // would reference an undefined component. Best-effort, mirroring remove-node's own
  // best-effort import bookkeeping in the other direction: a used tag with no matching default
  // import in the SOURCE file's frontmatter (a plain custom element, or an already-broken source
  // file) is left alone rather than guessed at.
  const newFileImportLines = carriedImportLines(byId, nodeId, source, relPath, newRelPath);

  const iface = generatePropsInterface(props);
  const destructure = generatePropsDestructure(props);
  const fmParts = [newFileImportLines, iface, destructure].filter(Boolean);
  const fmLines = fmParts.join("\n");
  const newFileContent = fmLines ? `---\n${fmLines}\n---\n${markup}\n` : `---\n---\n${markup}\n`;

  const attrsText = instanceAttrs.map(({ name, value }) => ` ${name}="${escapeAttr(value)}"`).join("");
  const instanceMarkup = `<${newName}${attrsText} />`;
  const withInstance = source.slice(0, nodeSpan[0]) + instanceMarkup + source.slice(nodeSpan[1]);

  const fmMatch = withInstance.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  let rewrittenOriginal;
  if (!fmMatch) {
    const importLine = `import ${newName} from "${importSpecifier(relPath, newRelPath)}";\n`;
    rewrittenOriginal = `---\n${importLine}---\n${withInstance}`;
  } else {
    const [, open, fmBody] = fmMatch;
    const fmBodyStart = fmMatch.index + open.length;
    const { source: newFmBody } = ensureImport(fmBody, { localName: newName, specifier: importSpecifier(relPath, newRelPath) });
    rewrittenOriginal = withInstance.slice(0, fmBodyStart) + newFmBody + withInstance.slice(fmBodyStart + fmBody.length);
  }

  return {
    extract: true,
    newFile: { path: newRelPath, content: newFileContent },
    original: { file: relPath, range: { start: 0, end: source.length }, replacement: rewrittenOriginal },
  };
}
