// Rich `InboxStore` for @dwk/webmention: re-fetches each verified source and parses its mf2 into an extended `webmentions` table so mentions render as full author cards. Wire the SAME instance into the queue consumer and the edge-render reader.
import { safeFetch } from "@dwk/webmention";
import { mf2 } from "microformats-parser";

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
  `verified_at INTEGER NOT NULL, ` +
  `PRIMARY KEY (source, target))`;

const UPSERT_SQL =
  `INSERT INTO webmentions ` +
  `(source, target, author_name, author_url, author_photo, content, url, type, published, verified_at) ` +
  `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ` +
  `ON CONFLICT (source, target) DO UPDATE SET ` +
  `author_name = excluded.author_name, author_url = excluded.author_url, ` +
  `author_photo = excluded.author_photo, content = excluded.content, ` +
  `url = excluded.url, type = excluded.type, published = excluded.published, ` +
  `verified_at = excluded.verified_at`;

// `published` is nullable TEXT; `verified_at` is INTEGER ms. A raw
// COALESCE(published, verified_at) would sort by type affinity (all integers
// before all text), so undated rows normalize to an ISO string — keeping the
// sort key uniformly text and chronological.
const ORDER_BY = `ORDER BY COALESCE(published, datetime(verified_at / 1000, 'unixepoch')) ASC`;
const SELECT_COLUMNS = `source, target, author_name, author_url, author_photo, content, url, type, published, verified_at`;

function rowToMention(row) {
  return {
    source: row.source,
    target: row.target,
    author_name: row.author_name ?? undefined,
    author_url: row.author_url ?? undefined,
    author_photo: row.author_photo ?? undefined,
    content: row.content ?? undefined,
    url: row.url ?? row.source,
    type: row.type ?? "mention",
    published: row.published ?? undefined,
    verifiedAt: row.verified_at,
  };
}

/**
 * Build the rich `InboxStore`. `fetchImpl` is injectable for tests; production
 * uses the global `fetch`.
 */
export function createRichWebmentionInbox(db, { fetchImpl = fetch } = {}) {
  let ready = null;
  const ensureSchema = () => {
    // Clear the cached promise on failure so a transient D1 error on the first
    // write doesn't permanently wedge the inbox for this isolate — the next call
    // retries the CREATE TABLE rather than re-awaiting a rejected promise.
    if (!ready) {
      ready = db
        .prepare(CREATE_TABLE_SQL)
        .run()
        .then(() => undefined)
        .catch((err) => {
          ready = null;
          throw err;
        });
    }
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
          // Cap below the package default (10s) so one slow source can't stall
          // the queue drain, which processes a batch's messages in sequence.
          { timeoutMs: 5000 },
        );
        if (response.ok) {
          parsed = { ...parsed, ...parseMention(await response.text(), mention) };
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
          ? db.prepare(`SELECT ${SELECT_COLUMNS} FROM webmentions ${ORDER_BY}`)
          : db
              .prepare(`SELECT ${SELECT_COLUMNS} FROM webmentions WHERE target = ?1 ${ORDER_BY}`)
              .bind(target);
      const { results } = await statement.all();
      return (results ?? []).map(rowToMention);
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
  const author = entry
    ? extractAuthor(properties)
    : card
      ? extractAuthor({ author: [card] })
      : {};

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
