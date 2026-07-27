import type { EmbedAsset, EmbedSnapshot } from "./types";

/** Named entities that actually show up in platform payloads. Numeric refs handled separately. */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

/**
 * Convert a platform's post HTML to plain text. Deliberately not a full HTML parser: the input
 * is a short, well-formed status body from a known API, and pulling in a parser dependency for
 * it would need issue approval. Block boundaries become blank lines so multi-paragraph posts
 * survive; everything else is dropped.
 */
/**
 * Strip tags until the string stops changing. A single pass over nested or malformed markup
 * (`<a<b>c>`) can leave a partial tag behind, and this function is exported — a future caller
 * might not escape its output. Escaping at render (`src/lib/embed-card.ts`) remains the actual
 * security boundary; this is defence in depth. Terminates because each pass strictly shortens
 * the string or leaves it unchanged.
 */
function stripTags(input: string): string {
  let out = input;
  for (let previous = ""; out !== previous; ) {
    previous = out;
    out = out.replace(/<[^>]*>/g, "");
  }
  return out;
}

export function htmlToText(html: string): string {
  return stripTags(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|blockquote)>/gi, "\n\n"),
  )
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rec(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function base(
  provider: EmbedSnapshot["provider"],
  canonicalURL: string,
  capturedAt: string,
): EmbedSnapshot {
  return {
    version: 1,
    url: canonicalURL,
    provider,
    author: { name: hostOf(canonicalURL) },
    content: "",
    media: [],
    capturedAt,
  };
}

/**
 * ISO-8601 or undefined — never an Invalid Date, whose `toISOString()` throws a `RangeError`
 * rather than producing anything writable. Platform payloads carry human-formatted dates
 * (X's oEmbed blockquote in particular), so unparseable input is routine, not exceptional.
 */
function isoOrUndefined(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function normalizeX(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot {
  const p = rec(payload);
  const snap = base("x", canonicalURL, capturedAt);
  const html = str(p.html) ?? "";
  // The oEmbed blockquote is <p>TEXT</p>&mdash; Name (@handle) <a ...>DATE</a>.
  snap.content = htmlToText(html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
  const name = str(p.author_name);
  if (name) snap.author.name = name;
  const authorURL = str(p.author_url);
  if (authorURL) {
    snap.author.url = authorURL;
    const handle = authorURL.match(/\/([A-Za-z0-9_]+)\/?$/)?.[1];
    if (handle) snap.author.handle = `@${handle}`;
  }
  snap.publishedAt = isoOrUndefined(html.match(/<a[^>]*>([^<]+)<\/a>\s*<\/blockquote>/i)?.[1]);
  // X's oEmbed exposes neither an avatar nor attached media — the card renders text-only.
  return snap;
}

export function normalizeYouTube(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot {
  const p = rec(payload);
  const snap = base("youtube", canonicalURL, capturedAt);
  snap.content = str(p.title) ?? "";
  const name = str(p.author_name);
  if (name) snap.author.name = name;
  snap.author.url = str(p.author_url);
  const thumb = str(p.thumbnail_url);
  if (thumb) {
    const asset: EmbedAsset = { src: thumb, alt: snap.content };
    const w = num(p.thumbnail_width);
    const h = num(p.thumbnail_height);
    if (w !== undefined) asset.width = w;
    if (h !== undefined) asset.height = h;
    snap.media.push(asset);
  }
  return snap;
}

export function normalizeBluesky(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot {
  const post = rec(rec(rec(payload).thread).post);
  const author = rec(post.author);
  const record = rec(post.record);
  const snap = base("bluesky", canonicalURL, capturedAt);
  snap.content = str(record.text) ?? "";
  const display = str(author.displayName);
  const handle = str(author.handle);
  if (display) snap.author.name = display;
  else if (handle) snap.author.name = handle;
  if (handle) {
    snap.author.handle = `@${handle}`;
    snap.author.url = `https://bsky.app/profile/${handle}`;
  }
  snap.author.avatar = str(author.avatar);
  snap.publishedAt = isoOrUndefined(str(record.createdAt));
  const images = rec(post.embed).images;
  if (Array.isArray(images)) {
    for (const raw of images) {
      const img = rec(raw);
      const src = str(img.fullsize) ?? str(img.thumb);
      if (!src) continue;
      const asset: EmbedAsset = { src, alt: str(img.alt) ?? "" };
      const ratio = rec(img.aspectRatio);
      const w = num(ratio.width);
      const h = num(ratio.height);
      if (w !== undefined) asset.width = w;
      if (h !== undefined) asset.height = h;
      snap.media.push(asset);
    }
  }
  return snap;
}

export function normalizeMastodon(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot {
  const p = rec(payload);
  const account = rec(p.account);
  const snap = base("mastodon", canonicalURL, capturedAt);
  snap.content = htmlToText(str(p.content) ?? "");
  const display = str(account.display_name);
  const acct = str(account.acct);
  if (display) snap.author.name = display;
  else if (acct) snap.author.name = acct;
  if (acct) snap.author.handle = `@${acct}`;
  snap.author.url = str(account.url);
  snap.author.avatar = str(account.avatar);
  snap.publishedAt = isoOrUndefined(str(p.created_at));
  if (Array.isArray(p.media_attachments)) {
    for (const raw of p.media_attachments) {
      const m = rec(raw);
      const src = str(m.url);
      if (!src || str(m.type) !== "image") continue;
      const asset: EmbedAsset = { src, alt: str(m.description) ?? "" };
      const original = rec(rec(m.meta).original);
      const w = num(original.width);
      const h = num(original.height);
      if (w !== undefined) asset.width = w;
      if (h !== undefined) asset.height = h;
      snap.media.push(asset);
    }
  }
  return snap;
}

function metaContent(html: string, property: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`,
    "i",
  );
  const tag = html.match(pattern)?.[0];
  if (!tag) return undefined;
  const raw = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
  return raw === undefined ? undefined : htmlToText(raw);
}

/** The `og:*` properties that count as "this page published Open Graph metadata". */
const OG_METADATA_PROPERTIES = ["og:title", "og:description", "og:image"] as const;

/**
 * True when the page carries at least one real `og:*` meta tag. This is the seam callers
 * need to distinguish "the page published Open Graph metadata" from `normalizeOpenGraph`'s
 * own fallback behavior: that function falls back to the `<title>` element when no `og:*`
 * tags are present, so it always yields non-empty `content` — even for a page like
 * Instagram's, which returns HTTP 200 with a `<title>` of "Instagram" and no `og:` tags at
 * all. `normalizeOpenGraph`'s output alone can't tell a caller which case happened; this
 * function inspects the same HTML directly, with no normalization or fallback, so it can.
 */
export function hasOpenGraphMetadata(html: string): boolean {
  return OG_METADATA_PROPERTIES.some((property) => (metaContent(html, property)?.length ?? 0) > 0);
}

export function normalizeOpenGraph(
  html: string,
  canonicalURL: string,
  capturedAt: string,
  fetchedURL: string = canonicalURL,
): EmbedSnapshot {
  const snap = base("opengraph", canonicalURL, capturedAt);
  const title = metaContent(html, "og:title") ?? htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = metaContent(html, "og:description") ?? "";
  snap.content = [title, description].filter((s) => s.length > 0).join(" — ");
  const siteName = metaContent(html, "og:site_name");
  if (siteName) snap.author.name = siteName;
  const image = metaContent(html, "og:image");
  // Resolve against `fetchedURL` (the page as actually retrieved), not `canonicalURL`: adapters.ts
  // strips the trailing slash from the latter for keying purposes, which would silently truncate
  // a document-relative `og:image` to the wrong sibling directory — see `absolutize` below.
  const imageURL = image ? absolutize(image, fetchedURL) : undefined;
  if (imageURL) snap.media.push({ src: imageURL, alt: title });
  return snap;
}

/**
 * Resolve an `og:image` against the page it was read from. The Open Graph spec asks for an
 * absolute URL, but plenty of sites publish `content="/img/hero.png"` or the protocol-relative
 * `content="//cdn.example.com/hero.png"` — and this is the *universal fallback* adapter, so
 * "plenty of sites" is the whole long tail. Left verbatim, neither form matches `store.ts`'s
 * `^https?://` remote test: it would never be collected, never downloaded, and would land in a
 * committed snapshot as a `media[].src` that is neither local nor fetchable — breaking both the
 * card (an image-less generic card, every time) and the invariant `types.ts` asserts.
 *
 * `baseURL` must be the URL the document was actually served from — not a canonicalized form
 * that may have lost a trailing slash — since a document-relative reference like `img/hero.png`
 * resolves differently against `.../post` (sibling of `post`) than `.../post/` (sibling of the
 * page itself).
 *
 * Returns undefined rather than throwing on a malformed value; a card with no image beats a
 * failed capture.
 */
function absolutize(value: string, baseURL: string): string | undefined {
  try {
    return new URL(value, baseURL).href;
  } catch {
    return undefined;
  }
}
