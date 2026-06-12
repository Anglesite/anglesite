/**
 * `create_page` / `create_post` MCP tool backends (#140 / A.6).
 *
 * Both scaffold a minimal, valid source file from a fixed template and commit it onto the
 * project's current branch (best-effort — the filesystem is the source of truth, so a missing
 * git repo or a rejecting hook leaves the file on disk and reports `commit: null` rather than
 * failing). Neither overwrites an existing file. These back the App Intents Add-Page / Add-Post
 * flows (A.5) and feed the same content graph `list_content` reports.
 *
 * @module
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Scaffold a new Astro page under `src/pages/`.
 *
 * @param {string} projectRoot
 * @param {{ name: string, route?: string }} input
 * @returns {{ filePath: string, route: string, commit: string | null }}
 */
export function createPage(projectRoot, { name, route }) {
  const title = (name ?? "").trim();
  if (!title) throw new Error("create_page requires a non-empty name");

  const normalizedRoute = normalizeRoute(route ?? slugify(title));
  if (normalizedRoute === "/") {
    throw new Error("create_page can't scaffold the site root; give the page a name or route");
  }
  const relPath = "src/pages" + normalizedRoute + ".astro";
  const abs = join(projectRoot, relPath);
  if (existsSync(abs)) throw new Error(`A page already exists at ${relPath}`);

  // Depth below src/pages/ decides how many `../` the layout import needs.
  const depth = normalizedRoute.replace(/^\//, "").split("/").length; // 1 for "/about"
  const layoutImport = "../".repeat(depth) + "layouts/BaseLayout.astro";

  writeFile(abs, pageTemplate({ title, layoutImport }));
  return { filePath: relPath, route: normalizedRoute, commit: commitFile(projectRoot, relPath, `anglesite: add page ${normalizedRoute}`) };
}

/**
 * Scaffold a new content-collection entry. Defaults to the `posts` collection (the on-disk
 * Astro collection name; the issue's colloquial "blog" maps here). New posts are created as
 * drafts so they stay out of the production build until the owner publishes.
 *
 * @param {string} projectRoot
 * @param {{ title: string, collection?: string, slug?: string }} input
 * @returns {{ filePath: string, slug: string, collection: string, commit: string | null }}
 */
export function createPost(projectRoot, { title, collection, slug }) {
  const cleanTitle = (title ?? "").trim();
  if (!cleanTitle) throw new Error("create_post requires a non-empty title");

  const coll = (collection ?? "posts").trim() || "posts";
  // `collection` becomes a path segment under src/content/, so it must not escape it. `slug`
  // is neutralized by slugify below, but `collection` is used verbatim — restrict it to a
  // single safe segment (no separators, dots, or traversal) rather than silently retargeting.
  if (!/^[A-Za-z0-9_-]+$/.test(coll)) {
    throw new Error(`Invalid collection name: ${coll}`);
  }
  const finalSlug = slugify(slug ?? cleanTitle);
  if (!finalSlug) throw new Error("create_post could not derive a slug from the title");

  const relPath = `src/content/${coll}/${finalSlug}.md`;
  const abs = join(projectRoot, relPath);
  if (existsSync(abs)) throw new Error(`A ${coll} entry already exists at ${relPath}`);

  writeFile(abs, postTemplate({ title: cleanTitle }));
  return {
    filePath: relPath,
    slug: finalSlug,
    collection: coll,
    commit: commitFile(projectRoot, relPath, `anglesite: add ${coll} ${finalSlug}`),
  };
}

// MARK: - Templates

function pageTemplate({ title, layoutImport }) {
  const description = `${title}.`;
  return `---
import BaseLayout from "${layoutImport}";
---

<BaseLayout title="${escapeAttr(title)}" description="${escapeAttr(description)}">
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>Add your content here.</p>
  </main>
</BaseLayout>
`;
}

function postTemplate({ title }) {
  const publishDate = new Date().toISOString();
  return `---
title: "${escapeYaml(title)}"
description: ""
publishDate: ${publishDate}
draft: true
tags: []
---

Write your post here.
`;
}

// MARK: - Git (best-effort, commits to HEAD on the current branch)

/**
 * Stage and commit exactly `relPath` on the current branch. Returns the new HEAD SHA, or null
 * on any failure (not a git repo, no prior commit, a pre-commit hook rejecting, git missing).
 * Commits a single pathspec so unrelated staged/working changes are left untouched.
 */
function commitFile(projectRoot, relPath, message) {
  const run = (args) =>
    execFileSync("git", args, { cwd: projectRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    run(["rev-parse", "--git-dir"]);
    run(["add", "--", relPath]);
    run(["commit", "-m", message, "--", relPath]);
    return run(["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

// MARK: - Helpers

function writeFile(abs, contents) {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

/** `/About//Us/` → `/about-us`; bare name → `/name`. Always leading-slash, no trailing slash. */
function normalizeRoute(route) {
  const segments = String(route)
    .split("/")
    .map((s) => slugify(s))
    .filter(Boolean);
  return "/" + segments.join("/");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeYaml(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
