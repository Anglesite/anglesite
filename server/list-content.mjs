/**
 * `list_content` MCP tool backend (#140 / A.6).
 *
 * Scans a project's `src/pages/`, the article-like content collections under `src/content/`,
 * and `public/images/`, returning a site-agnostic JSON projection. The Anglesite-app consumes
 * this via `ContentListing.parse(jsonText:siteID:)` (A.8, #142) to populate `SiteContentGraph`,
 * which backs the App Intents `PageEntity`/`PostEntity`/`ImageEntity` (A.2, #137) and the
 * Spotlight indexer (A.3). The payload carries NO siteID and NO entity ids — the app stamps
 * those, so the sidecar never needs to know which on-disk site it's serving.
 *
 * The filesystem is the source of truth; this is a read-only scan with no side effects.
 *
 * @module
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, basename, extname } from "node:path";
import { parseFrontmatter } from "./content-frontmatter.mjs";

/** Page source extensions that map to a navigable route. */
const PAGE_EXTENSIONS = new Set([".astro", ".md", ".mdx", ".markdown", ".html"]);
/** Content-collection entry extensions (Astro content layer glob: mdoc, mdx, md). */
const ENTRY_EXTENSIONS = new Set([".md", ".mdx", ".mdoc", ".markdown"]);
/** Raster/vector image extensions surfaced from `public/images/`. */
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"]);
/**
 * Collections whose entries are "posts" in the graph's sense — they carry title / publishDate /
 * draft / tags. Other collections (gallery, team, menus, submissions, …) don't fit the Post
 * shape and would pollute Siri's "show my drafts", so they're intentionally excluded (#140).
 */
const ARTICLE_COLLECTIONS = new Set(["posts", "notes", "episodes", "experiments"]);

const BUCKET_SCANNERS = { pages: scanPages, posts: scanPosts, images: scanImages };

/**
 * @param {string} projectRoot absolute path to the site root
 * @param {object} [options]
 * @param {"pages"|"posts"|"images"} [options.type] scan only this bucket; the other two come
 *   back empty instead of being walked (#392) — saves the filesystem walk, not just the tokens.
 * @param {number} [options.limit] cap each returned bucket to this many entries
 * @param {number} [options.offset] skip this many entries per bucket before applying `limit`
 * @param {string[]} [options.fields] project each entry down to only these keys
 * @returns {{ pages: object[], posts: object[], images: object[] }}
 */
export function listContent(projectRoot, { type, limit, offset = 0, fields } = {}) {
  const buckets = type ? [type] : Object.keys(BUCKET_SCANNERS);
  const result = { pages: [], posts: [], images: [] };
  for (const bucket of buckets) {
    let entries = BUCKET_SCANNERS[bucket](projectRoot);
    entries = entries.slice(offset);
    if (limit !== undefined) entries = entries.slice(0, limit);
    if (fields !== undefined) entries = entries.map((e) => pick(e, fields));
    result[bucket] = entries;
  }
  return result;
}

/** Project `obj` down to only the requested keys. Unknown keys are silently ignored. */
function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (key in obj) out[key] = obj[key];
  }
  return out;
}

// MARK: - Pages

function scanPages(projectRoot) {
  const pagesDir = join(projectRoot, "src", "pages");
  const out = [];
  for (const abs of walk(pagesDir)) {
    const rel = relative(projectRoot, abs);
    const relPosix = toPosix(rel);
    // Skip dynamic routes (`[slug]`, `[...rest]`) — they're templates, not concrete pages.
    if (relPosix.includes("[")) continue;
    if (!PAGE_EXTENSIONS.has(extname(abs).toLowerCase())) continue;

    out.push({
      route: routeFromPagePath(relPosix),
      filePath: relPosix,
      title: pageTitle(abs),
      lastModified: mtimeISO(abs),
    });
  }
  return out;
}

/** `src/pages/index.astro` → `/`, `src/pages/blog/index.astro` → `/blog`, `…/about.astro` → `/about`. */
function routeFromPagePath(relPosix) {
  let r = relPosix.replace(/^src\/pages\//, "").replace(/\.[^.]+$/, "");
  r = r.replace(/(^|\/)index$/, "$1");
  r = r.replace(/\/$/, "");
  return "/" + r;
}

/**
 * Best-effort page title: the `title="…"` (or `title='…'`) prop passed to a layout component,
 * else the first markdown frontmatter `title`, else null. `.astro` files have no standard
 * title field, so this is heuristic by design — the app treats Page.title as optional.
 */
function pageTitle(abs) {
  let text;
  try {
    text = readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(text);
  if (typeof fm.title === "string" && fm.title) return fm.title;
  const m = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(text);
  const found = m && (m[1] ?? m[2]);
  return found ? found : null;
}

// MARK: - Posts

function scanPosts(projectRoot) {
  const contentDir = join(projectRoot, "src", "content");
  const out = [];
  for (const collection of ARTICLE_COLLECTIONS) {
    const dir = join(contentDir, collection);
    for (const abs of walk(dir)) {
      if (!ENTRY_EXTENSIONS.has(extname(abs).toLowerCase())) continue;
      const relPosix = toPosix(relative(projectRoot, abs));
      const fm = readFrontmatter(abs);
      const slug = (typeof fm.slug === "string" && fm.slug) ? fm.slug : basename(abs, extname(abs));
      const title = (typeof fm.title === "string" && fm.title) ? fm.title : slug;
      out.push({
        collection,
        slug,
        title,
        draft: fm.draft === true,
        publishDate: dateISO(fm.publishDate ?? fm.date),
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        filePath: relPosix,
        lastModified: mtimeISO(abs),
      });
    }
  }
  return out;
}

function readFrontmatter(abs) {
  try {
    return parseFrontmatter(readFileSync(abs, "utf-8"));
  } catch {
    return {};
  }
}

// MARK: - Images

function scanImages(projectRoot) {
  const imagesDir = join(projectRoot, "public", "images");
  const out = [];
  for (const abs of walk(imagesDir)) {
    if (!IMAGE_EXTENSIONS.has(extname(abs).toLowerCase())) continue;
    let size = null;
    try {
      size = statSync(abs).size;
    } catch {
      // leave byteSize null
    }
    out.push({
      relativePath: toPosix(relative(projectRoot, abs)),
      fileName: basename(abs),
      byteSize: size,
      // Reverse "which pages use this image" is an expensive cross-scan; deferred (#140).
      usedOnPages: [],
      lastModified: mtimeISO(abs),
    });
  }
  return out;
}

// MARK: - Helpers

/** Recursively yield absolute file paths under `dir`. Missing dir → nothing. */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs);
    } else if (entry.isFile()) {
      yield abs;
    }
  }
}

function mtimeISO(abs) {
  try {
    return statSync(abs).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/** Normalize a frontmatter date value to an ISO string, or null if unparseable/absent. */
function dateISO(value) {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}
