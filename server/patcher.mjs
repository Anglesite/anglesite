import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, basename, dirname } from "node:path";
import { rewriteAstroStyle } from "./style-edit.mjs";
import { resolveComponentStyle } from "./component-style-edit.mjs";
import { COMPONENT_STYLE_OPS } from "./apply-edit-schema.mjs";

/**
 * @typedef {import('./apply-edit-schema.mjs').default} _unused
 * @typedef {{ file: string, range: { start: number, end: number }, replacement: string }} ResolveResult
 * @typedef {{ refused: true, reason: string, detail?: string }} ResolveRefusal
 */

/**
 * Resolve an edit payload to a source-file patch.
 *
 * Tries resolvers in priority order: edit-style → component-style ops → .mdoc →
 * Keystatic YAML/JSON → .astro. Returns the first non-refusal. If all refuse,
 * returns the most informative refusal (from the highest-priority resolver
 * that had an opinion).
 *
 * Async because `resolveComponentStyle` (component-style-edit.mjs) parses the
 * target .astro file with `@astrojs/compiler`, which is itself async. Every
 * other resolver here is synchronous; awaiting their (non-Promise) return
 * values is a no-op, so this doesn't change their behavior.
 *
 * @param {string} projectRoot
 * @param {{ path: string, selector: object, op: string, value?: unknown, component?: object }} edit
 * @returns {Promise<ResolveResult | ResolveRefusal>}
 */
export async function resolve(projectRoot, edit) {
  if (edit.op === "edit-style") {
    return resolveStyle(projectRoot, edit);
  }
  if (COMPONENT_STYLE_OPS.has(edit.op)) {
    return resolveComponentStyle(projectRoot, edit);
  }
  const resolvers = [resolveMdoc, resolveKeystatic, resolveAstro];
  let bestRefusal = /** @type {ResolveRefusal | null} */ (null);

  for (const resolver of resolvers) {
    const result = resolver(projectRoot, edit);
    if (!result.refused) return result;
    if (!bestRefusal || refusalPriority(result.reason) > refusalPriority(bestRefusal.reason)) {
      bestRefusal = result;
    }
  }

  return bestRefusal || refuse("no-match", "no resolver found candidate files");
}

const REASON_PRIORITY = {
  "dynamic-expression": 4,
  "ambiguous": 3,
  "patch-conflict": 2,
  "no-match": 1,
  "not-implemented": 0,
  "write-failed": 0,
  "invalid-input": 0,
};

function refusalPriority(reason) {
  return REASON_PRIORITY[reason] ?? 0;
}

/** Build a refusal object. */
function refuse(reason, detail) {
  const r = { refused: true, reason };
  if (detail !== undefined) r.detail = detail;
  return r;
}

// ── Shared helpers ────────────────────────────────────────────────

/**
 * Recursively collect files matching `predicate` under `dir`.
 * Skips node_modules, .git, dist, .astro.
 */
function walkFiles(dir, predicate) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (["node_modules", ".git", "dist", ".astro"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, predicate));
    } else if (predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Find all occurrences of `needle` in `haystack`, returning byte-offset ranges.
 * Returns [] if not found.
 */
function findAllOccurrences(haystack, needle) {
  if (!needle || needle.length === 0) return [];
  const matches = [];
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    matches.push({ start: idx, end: idx + needle.length });
    idx += 1;
  }
  return matches;
}

/**
 * Normalize text for fuzzy matching: collapse whitespace and trim.
 */
function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Derive the replacement string for a given op + value + matched source text.
 */
function buildReplacement(op, value, matchedSource) {
  if (op === "replace-text") {
    return typeof value === "string" ? value : String(value ?? "");
  }
  if (op === "replace-attr" && value && typeof value === "object") {
    return value.value != null ? String(value.value) : "";
  }
  if (op === "replace-image-src" && value && typeof value === "object") {
    // matchedSource is the entire opening <img …> tag. Rewrite its src and
    // srcset attributes while preserving everything else (alt, width, class,
    // data-*, etc). Existing src/srcset are replaced; missing srcset is added.
    return rewriteImgTag(matchedSource, value.src, value.srcset);
  }
  return typeof value === "string" ? value : "";
}

/**
 * Rewrite the src and srcset attributes inside an <img …> opening tag.
 * Preserves all other attributes. If srcset is absent in the source tag,
 * it's inserted right after src.
 *
 * @param {string} tagSource - e.g. '<img src="/foo.jpg" alt="x" />'
 * @param {string} newSrc
 * @param {string} newSrcset - empty string means "don't emit srcset"
 */
function rewriteImgTag(tagSource, newSrc, newSrcset) {
  let out = tagSource;
  if (/\ssrc=("[^"]*"|'[^']*')/i.test(out)) {
    out = out.replace(/(\ssrc=)("[^"]*"|'[^']*')/i, `$1"${newSrc}"`);
  } else {
    out = out.replace(/(\s*\/?>)$/, ` src="${newSrc}"$1`);
  }
  if (newSrcset) {
    if (/\ssrcset=("[^"]*"|'[^']*')/i.test(out)) {
      out = out.replace(/(\ssrcset=)("[^"]*"|'[^']*')/i, `$1"${newSrcset}"`);
    } else {
      out = out.replace(/(\ssrc="[^"]*")/i, `$1 srcset="${newSrcset}"`);
    }
  }
  return out;
}

/**
 * Given a src URL needle (e.g. "/images/hero.jpg"), find the full
 * opening tag that contains it. Returns an array of
 * {start, end, source} objects — or [] if not found.
 */
function findImgTagBySrc(source, srcNeedle) {
  const tagRe = /<img\b[^>]*\/?>/gi;
  let m;
  const matches = [];
  while ((m = tagRe.exec(source)) !== null) {
    if (m[0].includes(`src="${srcNeedle}"`) || m[0].includes(`src='${srcNeedle}'`)) {
      matches.push({ start: m.index, end: m.index + m[0].length, source: m[0] });
    }
  }
  return matches;
}

/**
 * Map a page path to candidate .astro files in src/pages/.
 * /about/ → [src/pages/about.astro, src/pages/about/index.astro]
 */
function pathToAstroCandidates(projectRoot, pagePath) {
  const normalized = pagePath.replace(/^\/|\/$/g, "") || "index";
  const pagesDir = join(projectRoot, "src", "pages");
  const candidates = [];

  if (normalized === "index") {
    candidates.push(join(pagesDir, "index.astro"));
  } else {
    candidates.push(join(pagesDir, `${normalized}.astro`));
    candidates.push(join(pagesDir, normalized, "index.astro"));
  }

  return candidates.filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Extract the slug from a page path by stripping any collection prefix.
 * /blog/my-post/ → my-post
 * /about/ → about
 */
function extractSlug(pagePath) {
  const segments = pagePath.replace(/^\/|\/$/g, "").split("/");
  return segments[segments.length - 1] || "";
}

// ── .mdoc resolver ────────────────────────────────────────────────

function resolveMdoc(projectRoot, edit) {
  const { path: pagePath, selector, op, value } = edit;
  const contentDir = join(projectRoot, "src", "content");
  const mdocFiles = walkFiles(contentDir, (name) => extname(name) === ".mdoc");

  if (mdocFiles.length === 0) {
    return refuse("no-match", "no .mdoc files found");
  }

  const textContent = selector.textContent;
  if (!textContent && op === "replace-text") {
    return refuse("no-match", "no textContent in selector for replace-text");
  }

  const slug = extractSlug(pagePath);
  const needle = op === "replace-text" ? textContent : getAttrSearchValue(op, selector, value);
  if (!needle) {
    return refuse("no-match", "nothing to search for in .mdoc files");
  }

  const normalizedNeedle = normalizeText(needle);
  const allMatches = [];

  for (const file of mdocFiles) {
    const fileSlug = basename(dirname(file)) === basename(file, ".mdoc")
      ? basename(dirname(file))
      : basename(file, ".mdoc");

    if (slug && fileSlug !== slug && fileSlug !== "index") {
      const parentDir = basename(dirname(file));
      if (parentDir !== slug) continue;
    }

    let source;
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const bodyStart = findFrontmatterEnd(source);

    if (op === "replace-text") {
      const occurrences = findTextInMdoc(source, normalizedNeedle, bodyStart);
      for (const range of occurrences) {
        allMatches.push({ file: relative(projectRoot, file), range });
      }
    }
  }

  if (allMatches.length === 0) {
    return refuse("no-match", "textContent not found in any .mdoc file");
  }
  if (allMatches.length > 1) {
    return refuse("ambiguous", `${allMatches.length} matches in .mdoc files: ${allMatches.map((m) => m.file).join(", ")}`);
  }

  return {
    file: allMatches[0].file,
    range: allMatches[0].range,
    replacement: buildReplacement(op, value),
  };
}

/**
 * Find the byte offset where frontmatter ends (after the closing ---).
 * Returns 0 if no frontmatter.
 */
function findFrontmatterEnd(source) {
  if (!source.startsWith("---")) return 0;
  const closeIdx = source.indexOf("\n---", 3);
  if (closeIdx === -1) return 0;
  const afterClose = source.indexOf("\n", closeIdx + 4);
  return afterClose === -1 ? closeIdx + 4 : afterClose + 1;
}

/**
 * Find exact occurrences of normalized text in the body of a .mdoc file.
 * Handles the fact that .mdoc text may have different whitespace than rendered HTML.
 */
function findTextInMdoc(source, normalizedNeedle, bodyStart) {
  const body = source.slice(bodyStart);
  const matches = [];

  // Try exact match first
  const exactMatches = findAllOccurrences(body, normalizedNeedle);
  if (exactMatches.length > 0) {
    return exactMatches.map((m) => ({
      start: bodyStart + m.start,
      end: bodyStart + m.end,
    }));
  }

  // Try normalized match: collapse whitespace in source and find spans
  const normalizedBody = normalizeText(body);
  const normalizedMatches = findAllOccurrences(normalizedBody, normalizedNeedle);
  if (normalizedMatches.length === 0) return matches;

  // Map normalized positions back to original source positions
  for (const nm of normalizedMatches) {
    const range = mapNormalizedRangeToSource(body, normalizedNeedle, nm.start);
    if (range) {
      matches.push({ start: bodyStart + range.start, end: bodyStart + range.end });
    }
  }

  return matches;
}

/**
 * Given a normalized-space position, map back to the original source range.
 * Walks the original string tracking how many non-collapsed characters we've seen.
 */
function mapNormalizedRangeToSource(original, needle, normalizedStart) {
  let normalizedIdx = 0;
  let sourceStart = -1;
  let inWhitespace = false;
  const trimmedStart = original.length - original.trimStart().length;

  for (let i = trimmedStart; i < original.length && normalizedIdx <= normalizedStart + needle.length; i++) {
    const ch = original[i];
    const isWs = /\s/.test(ch);

    if (isWs) {
      if (!inWhitespace) {
        if (normalizedIdx === normalizedStart) sourceStart = i;
        normalizedIdx++; // collapsed space
        inWhitespace = true;
      }
    } else {
      if (normalizedIdx === normalizedStart) sourceStart = i;
      normalizedIdx++;
      inWhitespace = false;
    }

    if (normalizedIdx === normalizedStart + needle.length && sourceStart !== -1) {
      return { start: sourceStart, end: i + 1 };
    }
  }

  return null;
}

// ── Keystatic resolver ────────────────────────────────────────────

function resolveKeystatic(projectRoot, edit) {
  const { path: pagePath, selector, op, value } = edit;
  const contentDir = join(projectRoot, "src", "content");

  const dataFiles = walkFiles(contentDir, (name) => {
    const ext = extname(name);
    return ext === ".yaml" || ext === ".yml" || ext === ".json";
  });

  if (dataFiles.length === 0) {
    return refuse("no-match", "no YAML/JSON content files found");
  }

  const textContent = selector.textContent;
  const needle = op === "replace-text" ? textContent : getAttrSearchValue(op, selector, value);
  if (!needle) {
    return refuse("no-match", "nothing to search for in Keystatic data files");
  }

  const slug = extractSlug(pagePath);
  const allMatches = [];

  for (const file of dataFiles) {
    const fileSlug = basename(file, extname(file));
    if (slug && fileSlug !== slug && fileSlug !== "index") {
      const parentDir = basename(dirname(file));
      if (parentDir !== slug) continue;
    }

    let source;
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const occurrences = findValueInDataFile(source, needle, extname(file));
    for (const range of occurrences) {
      allMatches.push({ file: relative(projectRoot, file), range });
    }
  }

  if (allMatches.length === 0) {
    return refuse("no-match", "value not found in Keystatic data files");
  }
  if (allMatches.length > 1) {
    return refuse("ambiguous", `${allMatches.length} matches in Keystatic data files`);
  }

  return {
    file: allMatches[0].file,
    range: allMatches[0].range,
    replacement: buildReplacement(op, value),
  };
}

/**
 * Find occurrences of a value in a YAML or JSON data file.
 * For YAML, searches for lines like `key: "value"` or `key: value`.
 * For JSON, searches for `"key": "value"`.
 */
function findValueInDataFile(source, needle, ext) {
  if (ext === ".json") {
    return findAllOccurrences(source, needle);
  }
  // YAML: search for the value as a string (possibly quoted)
  const matches = [];
  const quoted = findAllOccurrences(source, `"${needle}"`);
  for (const q of quoted) {
    // Include only the inner value, not the quotes
    matches.push({ start: q.start + 1, end: q.end - 1 });
  }
  const singleQuoted = findAllOccurrences(source, `'${needle}'`);
  for (const q of singleQuoted) {
    matches.push({ start: q.start + 1, end: q.end - 1 });
  }
  if (matches.length === 0) {
    return findAllOccurrences(source, needle);
  }
  return matches;
}

// ── .astro resolver ───────────────────────────────────────────────

/** Resolve an edit-style op to a whole-file rewrite of the owning .astro component. */
function resolveStyle(projectRoot, edit) {
  const { path: pagePath, selector, value } = edit;
  if (!value || typeof value !== "object" || !value.property || value.value === undefined) {
    return refuse("invalid-input", "edit-style value must be { property, value }");
  }
  const candidates = pathToAstroCandidates(projectRoot, pagePath);
  if (candidates.length === 0) {
    return refuse("no-match", `no .astro file found for path ${pagePath}`);
  }
  const hits = [];
  for (const file of candidates) {
    let source;
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const r = rewriteAstroStyle(source, selector, value.property, value.value);
    if (!r.refused) hits.push({ file: relative(projectRoot, file), source, r });
  }
  if (hits.length === 0) {
    return refuse("no-match", `could not locate <${selector.tag}> for style edit`);
  }
  if (hits.length > 1) {
    return refuse("ambiguous", `element matched in ${hits.length} .astro files`);
  }
  const { file, source, r } = hits[0];
  return { file, range: { start: 0, end: source.length }, replacement: r.next };
}

function resolveAstro(projectRoot, edit) {
  const { path: pagePath, selector, op, value } = edit;
  const candidates = pathToAstroCandidates(projectRoot, pagePath);

  if (candidates.length === 0) {
    return refuse("no-match", `no .astro file found for path ${pagePath}`);
  }

  if (op === "replace-image-src") {
    const currentSrc = selector.textContent;
    if (!currentSrc) {
      return refuse("no-match", "no current src to find in .astro files");
    }
    const allTagMatches = [];
    for (const file of candidates) {
      let source;
      try {
        source = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const matches = findImgTagBySrc(source, currentSrc);
      for (const tag of matches) {
        allTagMatches.push({ file: relative(projectRoot, file), tag });
      }
    }
    if (allTagMatches.length === 0) {
      return refuse("no-match", `no <img src="${currentSrc}"> found in .astro files`);
    }
    if (allTagMatches.length > 1) {
      return refuse("ambiguous", `${allTagMatches.length} <img> tags match src="${currentSrc}"`);
    }
    const only = allTagMatches[0];
    return {
      file: only.file,
      range: { start: only.tag.start, end: only.tag.end },
      replacement: buildReplacement(op, value, only.tag.source),
    };
  }

  const textContent = selector.textContent;
  const needle = op === "replace-text" ? textContent : getAttrSearchValue(op, selector, value);
  if (!needle) {
    return refuse("no-match", "nothing to search for in .astro files");
  }

  const allMatches = [];

  for (const file of candidates) {
    let source;
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const templateStart = findAstroTemplateStart(source);
    const template = source.slice(templateStart);

    const occurrences = findTextInAstroTemplate(source, needle, templateStart, selector);
    if (occurrences.length === 0 && hasDynamicExpressionEvidence(template, needle, selector)) {
      return refuse("dynamic-expression", `"${truncate(needle, 40)}" is rendered via a dynamic expression in ${relative(projectRoot, file)}`);
    }
    for (const range of occurrences) {
      allMatches.push({ file: relative(projectRoot, file), range });
    }
  }

  if (allMatches.length === 0) {
    return refuse("no-match", `textContent not found as static text in .astro template`);
  }
  if (allMatches.length > 1) {
    return refuse("ambiguous", `${allMatches.length} matches in .astro files`);
  }

  return {
    file: allMatches[0].file,
    range: allMatches[0].range,
    replacement: buildReplacement(op, value),
  };
}

/**
 * Find the start of the Astro template (after the closing --- of frontmatter).
 * Returns 0 if no frontmatter.
 */
function findAstroTemplateStart(source) {
  return findFrontmatterEnd(source);
}

/**
 * Check if there's positive evidence that the needle text is rendered via a
 * dynamic expression in the template. Only returns true when the template
 * contains `{...}` interpolation inside a tag context matching the selector.
 * Returns false when the text simply doesn't exist (that's a no-match, not
 * a dynamic-expression).
 */
function hasDynamicExpressionEvidence(template, needle, selector) {
  const tag = selector.tag?.toLowerCase();
  if (!tag) return false;

  const tagBlockRe = new RegExp(
    `<${tag}[^>]*>([\\s\\S]*?)</${tag}>`,
    "gi",
  );
  let m;
  while ((m = tagBlockRe.exec(template)) !== null) {
    const innerContent = m[1];
    if (/\{[^}]+\}/.test(innerContent)) {
      return true;
    }
  }

  return false;
}

/**
 * Find occurrences of text in the Astro template section.
 * Uses the selector's tag to narrow down matches when possible.
 */
function findTextInAstroTemplate(source, needle, templateStart, selector) {
  const template = source.slice(templateStart);
  const tag = selector.tag?.toLowerCase();

  // Try exact match in the template
  let matches = findAllOccurrences(template, needle);

  if (matches.length === 0) {
    // Try with normalized whitespace
    const normalizedNeedle = normalizeText(needle);
    const exactTrimmed = findAllOccurrences(template, normalizedNeedle);
    matches = exactTrimmed;
  }

  if (matches.length === 0) return [];

  // If we have the tag context, try to narrow to matches inside that tag
  if (tag && matches.length > 1) {
    const tagFiltered = matches.filter((m) => {
      const before = template.slice(Math.max(0, m.start - 200), m.start);
      const openTagRe = new RegExp(`<${tag}[^>]*>\\s*$`, "i");
      return openTagRe.test(before);
    });
    if (tagFiltered.length > 0) {
      matches = tagFiltered;
    }
  }

  return matches.map((m) => ({
    start: templateStart + m.start,
    end: templateStart + m.end,
  }));
}

/**
 * For non-replace-text ops, extract the search value from the selector/value.
 */
function getAttrSearchValue(op, selector, value) {
  if (op === "replace-attr" && value && typeof value === "object") {
    // We don't know the current attribute value from the edit payload alone;
    // the selector's textContent or other metadata is the best hint.
    return selector.textContent || null;
  }
  if (op === "replace-image-src") {
    return selector.textContent || null;
  }
  return null;
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}
