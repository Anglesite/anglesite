/**
 * Micropub D1→GitHub bridge.
 *
 * Materializes unsynced records from MICROPUB_DB into Keystatic .mdoc
 * files and commits them to the site repo via the GitHub Contents API.
 * Designed to run from the queue (event-driven) and scheduled (cron
 * retry) exports in site-entry.js.
 *
 * The Micropub handler returns 201 immediately after writing to D1.
 * This bridge runs asynchronously — a failed commit leaves the record
 * unsynced for cron retry and never blocks the Micropub response.
 *
 * Env bindings:
 *   MICROPUB_DB  (D1)     — Post records with a `synced` column
 *   GITHUB_TOKEN (secret) — Fine-grained PAT, contents:write only
 *
 * Reads from .site-config (via env vars or wrangler vars):
 *   GITHUB_REPO           — "owner/repo" for the site repository
 *   GITHUB_BRANCH         — Target branch (default: "main")
 */

const BATCH_SIZE = 25;
const CONTENT_PREFIX = "src/content/notes";
const GITHUB_API = "https://api.github.com";

/**
 * Process unsynced Micropub records: render to .mdoc and commit to GitHub.
 * Called from both queue() and scheduled() in site-entry.js.
 */
export async function sync(env) {
  if (!env.MICROPUB_DB || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return;

  const branch = env.GITHUB_BRANCH || "main";
  const [owner, repo] = env.GITHUB_REPO.split("/");
  if (!owner || !repo) return;

  const rows = await env.MICROPUB_DB
    .prepare(
      `SELECT id, slug, properties, deleted, created_at, updated_at
       FROM posts WHERE synced = 0 ORDER BY created_at ASC LIMIT ?`,
    )
    .bind(BATCH_SIZE)
    .all();

  if (!rows.results || rows.results.length === 0) return;

  for (const row of rows.results) {
    try {
      if (row.deleted) {
        await deleteFile(owner, repo, branch, row.slug, env.GITHUB_TOKEN);
      } else {
        const mdoc = renderMdoc(row);
        await commitFile(
          owner,
          repo,
          branch,
          row.slug,
          mdoc,
          row.deleted ? "delete" : row.updated_at ? "update" : "create",
          env.GITHUB_TOKEN,
        );
      }
      await env.MICROPUB_DB
        .prepare("UPDATE posts SET synced = 1 WHERE id = ?")
        .bind(row.id)
        .run();
    } catch (err) {
      console.error(`Bridge sync failed for ${row.slug}:`, err.message);
    }
  }
}

/**
 * Render a D1 post record to a Keystatic-compatible .mdoc string.
 * The `properties` column stores the mf2 JSON object.
 */
export function renderMdoc(row) {
  const props = typeof row.properties === "string"
    ? JSON.parse(row.properties)
    : row.properties;

  const fm = {};

  fm.slug = row.slug;

  fm.publishDate = extractFirst(props.published)
    || row.created_at
    || new Date().toISOString();

  const title = extractFirst(props.name);
  if (title) fm.title = title;

  const photo = extractFirst(props.photo);
  if (photo) {
    fm.image = typeof photo === "object" ? photo.value : photo;
    const alt = typeof photo === "object" ? photo.alt : extractFirst(props["photo-alt"]);
    if (alt) fm.imageAlt = alt;
  }

  const inReplyTo = extractFirst(props["in-reply-to"]);
  if (inReplyTo) fm.inReplyTo = inReplyTo;

  const bookmarkOf = extractFirst(props["bookmark-of"]);
  if (bookmarkOf) fm.bookmarkOf = bookmarkOf;

  const likeOf = extractFirst(props["like-of"]);
  if (likeOf) fm.likeOf = likeOf;

  const repostOf = extractFirst(props["repost-of"]);
  if (repostOf) fm.repostOf = repostOf;

  if (Array.isArray(props.syndication) && props.syndication.length > 0) {
    fm.syndication = props.syndication;
  }

  fm.draft = false;

  const body = extractContent(props.content);

  return serializeFrontmatter(fm) + "\n" + body + "\n";
}

/**
 * Commit a .mdoc file to GitHub via the Contents API.
 * Creates or updates (if the file already exists).
 */
async function commitFile(owner, repo, branch, slug, content, action, token) {
  const path = `${CONTENT_PREFIX}/${slug}.mdoc`;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const existing = await githubGet(url, branch, token);
  const sha = existing?.sha;

  const body = {
    message: `Micropub: ${action} note ${slug}`,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PUT ${path} ${res.status}: ${text}`);
  }
}

/**
 * Delete a .mdoc file from GitHub via the Contents API.
 */
async function deleteFile(owner, repo, branch, slug, token) {
  const path = `${CONTENT_PREFIX}/${slug}.mdoc`;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const existing = await githubGet(url, branch, token);
  if (!existing?.sha) return;

  const res = await fetch(url, {
    method: "DELETE",
    headers: githubHeaders(token),
    body: JSON.stringify({
      message: `Micropub: delete note ${slug}`,
      sha: existing.sha,
      branch,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub DELETE ${path} ${res.status}: ${text}`);
  }
}

/**
 * GET a file from the GitHub Contents API. Returns { sha } or null.
 */
async function githubGet(url, branch, token) {
  const res = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GET ${res.status}: ${text}`);
  }
  return res.json();
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "anglesite-micropub-bridge",
    "Content-Type": "application/json",
  };
}

/**
 * Extract the first value from an mf2 property array.
 * mf2 properties are always arrays: { "name": ["My Title"] }
 */
function extractFirst(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return arr[0];
}

/**
 * Extract body text from an mf2 content property.
 * content can be: ["plain text"], [{ html: "...", value: "..." }], or [{ value: "..." }]
 */
function extractContent(content) {
  const first = extractFirst(content);
  if (!first) return "";
  if (typeof first === "string") return first;
  if (first.value) return first.value;
  if (first.html) return htmlToPlain(first.html);
  return "";
}

/**
 * Minimal HTML-to-plain-text conversion for note content.
 * Micropub notes are typically short — strip tags, decode entities.
 */
function htmlToPlain(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Serialize a frontmatter object to YAML.
 * Handles strings, booleans, and arrays of strings.
 */
function serializeFrontmatter(obj) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${yamlString(item)}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlString(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function yamlString(val) {
  const s = String(val);
  if (
    s === "" ||
    s === "true" ||
    s === "false" ||
    s === "null" ||
    /^[\d.]+$/.test(s) ||
    /[:#{}[\],&*?|>!%@`'"]/.test(s) ||
    s.startsWith(" ") ||
    s.endsWith(" ")
  ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}
