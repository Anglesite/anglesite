/**
 * Webmention runtime for the site Worker — receiver dispatch, queue consumer,
 * and the per-request edge-render that injects stored mentions into a page.
 *
 * This module is the ONLY part of `site-entry.js`'s feature set that pulls
 * external packages (`@dwk/webmention` + `microformats-parser`), so it is kept
 * in a separate file that `site-entry.js` imports ONLY when the owner runs
 * `/anglesite:indieweb` and selects Webmention. A site without Webmention never
 * imports this module, so its Worker bundle stays free of these dependencies.
 *
 * Composition against the published `@dwk/webmention` (0.1.x):
 *   - `createWebmention({ baseUrl })` → the `/webmention` receiver. It validates
 *     source/target synchronously, enqueues the pair on WEBMENTION_QUEUE, and
 *     returns 202. `baseUrl` is the site origin (taken per request) so only
 *     mentions targeting this site are accepted.
 *   - `createWebmentionQueueConsumer({ inbox })` → the queue consumer. It
 *     fetches each source, confirms it links to the target, and calls
 *     `inbox.store()` / `inbox.remove()`. We supply a CUSTOM inbox (below) so a
 *     stored mention carries the author h-card + content, not just source/target
 *     — the package's default D1 inbox only persists `(source, target,
 *     verified_at)`.
 *
 * The custom inbox re-fetches the source (SSRF-guarded via the package's
 * `safeFetch`) and parses its microformats2 to extract author name/url/photo,
 * content, permalink, and reply/like/repost type, persisting them to an
 * extended `webmentions` table that the edge-render reads.
 */
import {
  createWebmention,
  createWebmentionQueueConsumer,
  safeFetch,
} from "@dwk/webmention";
import { mf2 } from "microformats-parser";

// ---------------------------------------------------------------------------
// Receiver + queue-consumer factories (memoized so each isolate builds one).
// ---------------------------------------------------------------------------

const receivers = new Map(); // origin -> receiver handler
const consumers = new WeakMap(); // WEBMENTION_DB binding -> queue consumer

/** Dispatch a `/webmention` POST to the receiver for this site origin. */
export function handleWebmention(request, env, ctx, origin) {
  let receiver = receivers.get(origin);
  if (!receiver) {
    receiver = createWebmention({ baseUrl: origin });
    receivers.set(origin, receiver);
  }
  return receiver(request, env, ctx);
}

/** Drain a batch of queued webmention jobs through the verifying consumer. */
export function drainWebmentionQueue(batch, env, ctx) {
  if (!env.WEBMENTION_DB) return Promise.resolve();
  let consumer = consumers.get(env.WEBMENTION_DB);
  if (!consumer) {
    consumer = createWebmentionQueueConsumer({
      inbox: createWebmentionInbox(env.WEBMENTION_DB),
    });
    consumers.set(env.WEBMENTION_DB, consumer);
  }
  return consumer(batch, env, ctx);
}

// ---------------------------------------------------------------------------
// Custom inbox — parses the source's mf2 and persists the rich mention.
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL =
  `CREATE TABLE IF NOT EXISTS webmentions (` +
  `source TEXT NOT NULL, ` +
  `target TEXT NOT NULL, ` +
  `author_name TEXT, ` +
  `author_url TEXT, ` +
  `author_photo TEXT, ` +
  `content TEXT, ` +
  `url TEXT, ` +
  `type TEXT, ` +
  `published TEXT, ` +
  `status TEXT NOT NULL DEFAULT 'verified', ` +
  `verified_at INTEGER NOT NULL, ` +
  `PRIMARY KEY (source, target))`;

const UPSERT_SQL =
  `INSERT INTO webmentions ` +
  `(source, target, author_name, author_url, author_photo, content, url, type, published, status, verified_at) ` +
  `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'verified', ?10) ` +
  `ON CONFLICT (source, target) DO UPDATE SET ` +
  `author_name = excluded.author_name, author_url = excluded.author_url, ` +
  `author_photo = excluded.author_photo, content = excluded.content, ` +
  `url = excluded.url, type = excluded.type, published = excluded.published, ` +
  `status = 'verified', verified_at = excluded.verified_at`;

/**
 * Build an `InboxStore` (the `@dwk/webmention` contract: `store`/`remove`/
 * `list`) backed by D1. `store()` re-fetches the source and parses its mf2 so
 * the row carries author + content. A fetch/parse failure degrades to a
 * source/target-only row rather than dropping the verified mention.
 *
 * `fetchImpl` is injectable for tests; production uses the global `fetch`.
 */
export function createWebmentionInbox(db, { fetchImpl = fetch } = {}) {
  let ready = null;
  const ensureSchema = () => {
    ready ??= db
      .prepare(CREATE_TABLE_SQL)
      .run()
      .then(() => undefined);
    return ready;
  };

  return {
    async store(mention) {
      await ensureSchema();
      let parsed = { type: "mention", url: mention.source };
      try {
        const { response } = await safeFetch(
          fetchImpl,
          mention.source,
          { headers: { accept: "text/html" } },
          { timeoutMs: 8000 },
        );
        if (response.ok) {
          parsed = {
            ...parsed,
            ...parseMention(await response.text(), mention),
          };
        }
      } catch (err) {
        // SSRF block, timeout, or unparseable source — keep the verified pair.
        console.error("Webmention mf2 parse failed:", err?.message);
      }
      await db
        .prepare(UPSERT_SQL)
        .bind(
          mention.source,
          mention.target,
          parsed.author_name ?? null,
          parsed.author_url ?? null,
          parsed.author_photo ?? null,
          parsed.content ?? null,
          parsed.url ?? mention.source,
          parsed.type ?? "mention",
          parsed.published ?? null,
          mention.verifiedAt,
        )
        .run();
    },

    async remove(source, target) {
      await ensureSchema();
      await db
        .prepare(`DELETE FROM webmentions WHERE source = ?1 AND target = ?2`)
        .bind(source, target)
        .run();
    },

    async list(target) {
      await ensureSchema();
      const statement =
        target === undefined
          ? db.prepare(
              `SELECT source, target, verified_at FROM webmentions ORDER BY verified_at DESC`,
            )
          : db
              .prepare(
                `SELECT source, target, verified_at FROM webmentions WHERE target = ?1 ORDER BY verified_at DESC`,
              )
              .bind(target);
      const { results } = await statement.all();
      return (results ?? []).map((row) => ({
        source: row.source,
        target: row.target,
        verifiedAt: row.verified_at,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// microformats2 extraction — turn a source page into a rich mention record.
// ---------------------------------------------------------------------------

// Reply/like/repost/bookmark properties, in the order we report them. The first
// one whose value points at the target decides the mention's `type`.
const RESPONSE_TYPES = [
  ["like-of", "like"],
  ["repost-of", "repost"],
  ["in-reply-to", "reply"],
  ["bookmark-of", "bookmark"],
];

/** First string-ish value of an mf2 property, or undefined. */
function valueOf(prop) {
  if (prop == null) return undefined;
  if (typeof prop === "string") return prop;
  // Html ({ value, html }) or Image ({ value, alt }) or h-* root ({ value }).
  if (typeof prop.value === "string") return prop.value;
  return undefined;
}

function firstString(properties, key) {
  const values = properties?.[key];
  return Array.isArray(values) ? valueOf(values[0]) : undefined;
}

/** Whether an mf2 property value (string, h-cite root, or url) is `target`. */
function pointsAt(prop, target) {
  if (typeof prop === "string") return prop === target;
  if (prop && typeof prop === "object") {
    if (valueOf(prop) === target) return true;
    const url = prop.properties && firstString(prop.properties, "url");
    if (url === target) return true;
  }
  return false;
}

function detectType(properties, target) {
  for (const [key, type] of RESPONSE_TYPES) {
    const values = properties?.[key];
    if (Array.isArray(values) && values.some((v) => pointsAt(v, target))) {
      return type;
    }
  }
  return "mention";
}

function extractAuthor(properties) {
  const author = properties?.author?.[0];
  if (author == null) return {};
  if (typeof author === "string") return { author_name: author };
  const props = author.properties ?? {};
  return {
    author_name: firstString(props, "name"),
    author_url: firstString(props, "url"),
    author_photo: firstString(props, "photo"),
  };
}

function extractContent(properties) {
  const content = properties?.content?.[0];
  const text =
    valueOf(content) ?? firstString(properties, "summary") ?? firstString(properties, "name");
  if (!text) return undefined;
  // Cap stored content; the edge-render escapes it, this just bounds storage.
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
}

/**
 * Parse the `h-entry` (or bare `h-card`) of a webmention source into the row
 * the edge-render expects. `mention` provides `source`/`target` fallbacks.
 */
export function parseMention(html, { source, target }) {
  let entry;
  let card;
  try {
    const { items } = mf2(html, { baseUrl: source });
    for (const item of items ?? []) {
      const types = item.type ?? [];
      if (!entry && types.includes("h-entry")) entry = item;
      if (!card && types.includes("h-card")) card = item;
    }
  } catch (err) {
    console.error("Webmention mf2 parse error:", err?.message);
  }

  // A bare h-card source (e.g. a "likes" aggregator) still yields an author.
  const properties = entry?.properties ?? {};
  const author = entry ? extractAuthor(properties) : card ? extractAuthor({ author: [card] }) : {};

  return {
    author_name: author.author_name,
    author_url: author.author_url,
    author_photo: author.author_photo,
    content: extractContent(properties),
    url: firstString(properties, "url") ?? source,
    type: detectType(properties, target),
    published: firstString(properties, "published"),
  };
}

// ---------------------------------------------------------------------------
// Edge-render — inject stored mentions into note/post pages.
// ---------------------------------------------------------------------------

// Only note and blog-post permalinks can be webmention targets. The collection
// index pages (`/notes`, `/blog`) are excluded — the trailing-slash strip means
// a bare `/notes` never matches `"/notes/"`. Matching the path up front keeps
// the per-request D1 work off pages that can't have mentions.
function isWebmentionTarget(pathname) {
  const p = pathname.replace(/\/+$/, "");
  return p.startsWith("/notes/") || p.startsWith("/blog/");
}

// Per-isolate cache of known target URLs, refreshed at most once per TTL — so
// every mention-free note/post request is an in-memory set lookup, not a query.
const WEBMENTION_TARGETS_TTL_MS = 60_000;
const webmentionTargetsCache = new WeakMap();

async function loadWebmentionTargets(db) {
  const cached = webmentionTargetsCache.get(db);
  if (cached && cached.expires > Date.now()) return cached.targets;
  try {
    const rows = await db
      .prepare(`SELECT DISTINCT target FROM webmentions WHERE status = 'verified'`)
      .all();
    const targets = new Set((rows?.results ?? []).map((row) => row.target));
    webmentionTargetsCache.set(db, {
      targets,
      expires: Date.now() + WEBMENTION_TARGETS_TTL_MS,
    });
    return targets;
  } catch (err) {
    console.error("Webmention target-set query failed:", err?.message);
    return cached?.targets ?? new Set();
  }
}

async function loadWebmentions(db, target) {
  try {
    const rows = await db
      .prepare(
        `SELECT author_name, author_url, author_photo, content, url, type, published
         FROM webmentions
         WHERE target = ?1 AND status = 'verified'
         ORDER BY published ASC`,
      )
      .bind(target)
      .all();
    return rows?.results ?? [];
  } catch (err) {
    console.error("Webmention edge-render query failed:", err?.message);
    return [];
  }
}

class WebmentionInjector {
  constructor(mentions) {
    this.mentions = mentions;
  }
  element(el) {
    const items = this.mentions.map(renderMention).join("");
    el.setInnerContent(
      `<h2 class="webmentions-title">Mentions</h2>` +
        `<ol class="webmentions-list">${items}</ol>`,
      { html: true },
    );
  }
}

/**
 * If the response is a note/post HTML page with stored mentions, inject them
 * into its `#webmentions` container. Self-gates on WEBMENTION_DB and the target
 * path so `site-entry.js` can call it unconditionally for HTML responses.
 */
export async function injectWebmentions(response, env, url) {
  if (!env.WEBMENTION_DB || !isWebmentionTarget(url.pathname)) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const target = `${url.origin}${url.pathname}`;
  const targets = await loadWebmentionTargets(env.WEBMENTION_DB);
  if (!targets.has(target)) return response;

  const mentions = await loadWebmentions(env.WEBMENTION_DB, target);
  if (mentions.length === 0) return response;

  return new HTMLRewriter()
    .on("#webmentions", new WebmentionInjector(mentions))
    .transform(response);
}

// ---------------------------------------------------------------------------
// Rendering — XSS-hardened (issue #363). Exported for unit tests.
// ---------------------------------------------------------------------------

export function renderMention(m) {
  // Webmention fields originate from arbitrary external sites. escapeHtml()
  // blocks HTML metacharacters but NOT dangerous URL schemes (javascript:,
  // data:), so every URL that lands in an href/src must pass safeUrl() first.
  const authorUrl = safeUrl(m.author_url);
  const authorPhoto = safeUrl(m.author_photo);
  const permalinkUrl = safeUrl(m.url);

  const name = escapeHtml(m.author_name || authorUrl || "Someone");
  const photo = authorPhoto
    ? `<img class="u-photo" src="${escapeHtml(authorPhoto)}" alt="" width="48" height="48" />`
    : "";
  const author = authorUrl
    ? `<a class="p-author h-card u-url" rel="nofollow ugc noopener" href="${escapeHtml(authorUrl)}">${name}</a>`
    : `<span class="p-author">${name}</span>`;
  const content = m.content
    ? `<div class="p-content">${escapeHtml(m.content)}</div>`
    : "";
  const permalink = permalinkUrl
    ? `<a class="u-url" rel="nofollow ugc noopener" href="${escapeHtml(permalinkUrl)}">permalink</a>`
    : "";
  return `<li class="h-cite">${photo}${author}${content}${permalink}</li>`;
}

// Allowlist http(s) URLs only. Returns the normalized URL string, or null for
// anything that isn't a parseable http/https URL (blocks javascript:, data:,
// vbscript:, relative junk, etc.).
export function safeUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
