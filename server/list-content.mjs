import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Discover a site's content (pages, posts, images) for the `list_content` MCP tool.
 *
 * The payload is **site-agnostic**: no `siteID`, no entity `id` — the Anglesite-app
 * stamps those itself (`Sources/AnglesiteCore/ContentListing.swift`). Timestamps are
 * ISO-8601; `filePath`/`relativePath` are projectRoot-relative with POSIX separators.
 *
 * @param {string} projectRoot Absolute path to the site root.
 * @returns {{ pages: object[], posts: object[], images: object[] }}
 */
export function listContent(projectRoot) {
  return {
    pages: discoverPages(projectRoot),
    posts: discoverPosts(projectRoot),
    images: discoverImages(projectRoot),
  };
}

// ── Pages ─────────────────────────────────────────────────────────

const PAGE_EXTENSIONS = [".astro", ".md", ".mdx", ".html"];

function discoverPages(projectRoot) {
  const pagesDir = join(projectRoot, "src", "pages");
  const files = walkFiles(pagesDir, (name) =>
    PAGE_EXTENSIONS.some((ext) => name.endsWith(ext)),
  );
  const pages = [];
  for (const file of files) {
    const routePath = relative(pagesDir, file);
    // Dynamic routes (`[slug]`, `[...rest]`) need params we can't enumerate
    // statically — skip them rather than emit a literal `/blog/[slug]` route.
    if (routePath.includes("[")) continue;
    const page = {
      route: deriveRoute(routePath),
      filePath: toRelativePosix(projectRoot, file),
      lastModified: mtimeISO(file),
    };
    const title = scalar(frontmatterBlock(readFileSafe(file)), "title");
    if (title) page.title = title;
    pages.push(page);
  }
  return pages;
}

/** `index.astro` → `/`, `about.astro` → `/about`, `blog/index.astro` → `/blog`. */
function deriveRoute(routePath) {
  let r = routePath.split(sep).join("/");
  r = r.replace(/\.[^.]+$/, ""); // drop extension
  r = r.replace(/(^|\/)index$/, ""); // collapse trailing index
  return "/" + r;
}

// ── Images ────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico",
];

function discoverImages(projectRoot) {
  const dirs = [join(projectRoot, "public"), join(projectRoot, "src", "assets")];
  const isImage = (name) =>
    IMAGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

  // Precompute (route, source) for every page once, so usedOnPages is a
  // substring scan rather than a re-walk per image.
  const pagesDir = join(projectRoot, "src", "pages");
  const pageRefs = walkFiles(pagesDir, (name) =>
    PAGE_EXTENSIONS.some((ext) => name.endsWith(ext)),
  ).map((file) => ({
    route: deriveRoute(relative(pagesDir, file)),
    text: readFileSafe(file),
  }));

  const images = [];
  for (const dir of dirs) {
    for (const file of walkFiles(dir, isImage)) {
      const fileName = file.split(sep).pop();
      const usedOnPages = pageRefs
        .filter((p) => p.text.includes(fileName))
        .map((p) => p.route);
      images.push({
        relativePath: toRelativePosix(projectRoot, file),
        fileName,
        byteSize: statSync(file).size,
        usedOnPages: [...new Set(usedOnPages)].sort(),
        lastModified: mtimeISO(file),
      });
    }
  }
  return images;
}

// ── Posts ─────────────────────────────────────────────────────────

const POST_EXTENSIONS = [".mdoc", ".mdx", ".md"];

function discoverPosts(projectRoot) {
  const contentDir = join(projectRoot, "src", "content");
  let collections;
  try {
    collections = readdirSync(contentDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const posts = [];
  for (const entry of collections) {
    if (!entry.isDirectory()) continue;
    const collection = entry.name;
    const collectionDir = join(contentDir, collection);
    const files = walkFiles(collectionDir, (name) =>
      POST_EXTENSIONS.some((ext) => name.endsWith(ext)),
    );
    for (const file of files) {
      const slug = deriveSlug(relative(collectionDir, file));
      const fm = frontmatterBlock(readFileSafe(file));
      const post = {
        collection,
        slug,
        title: scalar(fm, "title") ?? slug,
        draft: boolean(fm, "draft") ?? false,
        tags: stringArray(fm, "tags"),
        filePath: toRelativePosix(projectRoot, file),
        lastModified: mtimeISO(file),
      };
      const publishDate = normalizeDate(scalar(fm, "publishDate"));
      if (publishDate) post.publishDate = publishDate;
      posts.push(post);
    }
  }
  return posts;
}

/** Astro glob-loader id: path under the collection base, minus extension. */
function deriveSlug(entryPath) {
  return entryPath.split(sep).join("/").replace(/\.[^.]+$/, "");
}

// ── Shared helpers ──────────────────────────────────────────────────

/** Recursively collect files matching `predicate`. Skips build/vcs dirs. */
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

function toRelativePosix(projectRoot, file) {
  return relative(projectRoot, file).split(sep).join("/");
}

function mtimeISO(file) {
  return statSync(file).mtime.toISOString();
}

function readFileSafe(file) {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

// ── Minimal frontmatter parsing ─────────────────────────────────────
// The repo ships no YAML dependency; these cover the scalar/boolean/list
// shapes the content schemas use (see template/src/content.config.ts).

/** The raw text inside a leading `---` … `---` block, or "" if absent. */
function frontmatterBlock(source) {
  const m = source.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

/** A single-line scalar value (`key: value`), quotes stripped. */
function scalar(fm, key) {
  const line = fm.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"));
  if (!line) return undefined;
  const v = line[1].trim();
  if (v === "" || v === "[]") return undefined;
  return stripQuotes(v);
}

/** A boolean value; `undefined` when the key is absent. */
function boolean(fm, key) {
  const v = scalar(fm, key);
  if (v === undefined) return undefined;
  return v === "true";
}

/**
 * A string array, supporting inline (`key: [a, b]`) and YAML block lists:
 *   key:
 *     - a
 *     - b
 * Returns `[]` when the key is absent or empty.
 */
function stringArray(fm, key) {
  const inline = fm.match(new RegExp(`^${key}:[ \\t]*\\[(.*)\\]`, "m"));
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }
  const block = fm.match(new RegExp(`^${key}:[ \\t]*\\n((?:[ \\t]+.*(?:\\n|$))+)`, "m"));
  if (block) {
    return block[1]
      .split("\n")
      .map((l) => l.match(/^[ \t]*-[ \t]*(.+)$/))
      .filter(Boolean)
      .map((m) => stripQuotes(m[1].trim()));
  }
  return [];
}

/** Normalize a date string to a full ISO-8601 datetime, or `undefined`. */
function normalizeDate(raw) {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function stripQuotes(v) {
  return v.replace(/^["'](.*)["']$/, "$1");
}
