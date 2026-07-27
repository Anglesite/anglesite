import type { EmbedSnapshot } from "../../scripts/embeds/types";

/**
 * Escape untrusted text for HTML text and double-quoted-attribute contexts. Post content,
 * author names and alt text all come from a remote platform and are stored as plain text —
 * this is the single point where they become markup.
 */
export function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface CardOptions {
  /** Microformats root for reply context: "u-in-reply-to" | "u-bookmark-of" | "u-like-of". */
  citeClass?: string;
  /**
   * Opt in to an inline youtube-nocookie iframe (EMBED_VIDEO_INLINE=true). The player is
   * `loading="lazy"`, so it is requested when it scrolls into view — not on a click.
   */
  inlineVideo?: boolean;
}

/**
 * Only repo-relative paths written by the snapshotter are renderable. A remote src here would
 * mean a bug upstream leaked a platform CDN URL into a committed snapshot; refusing it at render
 * keeps the privacy guarantee true even then. `pre-deploy-check.ts` is the backstop for output
 * this function never saw.
 */
function isLocalAsset(src: string): boolean {
  return src.startsWith("/embeds/");
}

function youTubeID(url: string): string | null {
  try {
    return new URL(url).searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * `escapeHTML` neutralizes markup-breaking characters, but it has no opinion on URL *scheme* —
 * `javascript:...` or `data:text/html,...` survive escaping byte-for-byte and become a
 * clickable, script-executing link once rendered into an `href`. Both `author.url` and `url`
 * are remote-derived (Mastodon is federated with no host allowlist, so any cited instance
 * fully controls `author.url`; snapshots are also committed files owners are invited to
 * hand-edit, so `url` can't assume it only ever came from `resolveAdapter`). Mirrors the
 * protocol check in `scripts/embeds/adapters.ts` so both call sites agree on what counts as
 * a link. Do not remove this in favor of escaping alone — escaping and scheme-gating guard
 * against different things.
 */
function isSafeHref(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function renderEmbedCard(snap: EmbedSnapshot, options: CardOptions = {}): string {
  const cite = options.citeClass;
  const rootClass = `embed-card embed-card--${snap.provider}${cite ? ` ${cite} h-cite` : ""}`;
  const parts: string[] = [];

  const avatar =
    snap.author.avatar && isLocalAsset(snap.author.avatar)
      ? `<img class="embed-card__avatar" src="${escapeHTML(snap.author.avatar)}" alt="" width="48" height="48" loading="lazy" decoding="async">`
      : "";
  const handle = snap.author.handle ? `<span class="embed-card__handle">${escapeHTML(snap.author.handle)}</span>` : "";
  const authorInner = `${avatar}<span class="embed-card__name">${escapeHTML(snap.author.name)}</span>${handle}`;
  const authorClass = `embed-card__author${cite ? " p-author h-card" : ""}`;
  parts.push(
    snap.author.url && isSafeHref(snap.author.url)
      ? `<a class="${authorClass}" href="${escapeHTML(snap.author.url)}" rel="noopener noreferrer">${authorInner}</a>`
      : `<span class="${authorClass}">${authorInner}</span>`,
  );

  if (snap.content) {
    parts.push(`<p class="embed-card__text${cite ? " p-content" : ""}">${escapeHTML(snap.content)}</p>`);
  }

  const videoID = snap.provider === "youtube" ? youTubeID(snap.url) : null;
  if (options.inlineVideo && videoID) {
    // This is scroll-triggered, not click-to-load: `loading="lazy"` defers the request until
    // the frame approaches the viewport, and the visitor takes no action to trigger it. A page
    // the visitor never scrolls that far down makes no youtube-nocookie request at all.
    //
    // A real click-to-load facade is deliberately not implemented. It would need first-party
    // JavaScript delivered as a file — the CSP is `script-src 'self'` with no 'unsafe-inline',
    // and this markup is injected via a remark `html` node / `set:html`, which Astro's bundler
    // never scans for `<script>`. Adding a script-delivery mechanism for an opt-in path cuts
    // against the whole no-JS thesis of the feature. What keeps this acceptable instead: it is
    // off by default, turning it on is a recorded and reversible `.site-config` edit, the host
    // is `youtube-nocookie.com`, and `frame-src` widens to exactly that one host.
    parts.push(
      `<iframe class="embed-card__video" src="https://www.youtube-nocookie.com/embed/${escapeHTML(videoID)}" ` +
        `title="${escapeHTML(snap.content)}" loading="lazy" allowfullscreen ` +
        `referrerpolicy="no-referrer" frameborder="0"></iframe>`,
    );
  }

  // Media the card renders itself — everything except an inline player's own frame.
  let mediaHTML = "";
  if (!(options.inlineVideo && videoID)) {
    for (const asset of snap.media) {
      if (!isLocalAsset(asset.src)) continue;
      const dims = `${asset.width ? ` width="${asset.width}"` : ""}${asset.height ? ` height="${asset.height}"` : ""}`;
      mediaHTML += `<img class="embed-card__media" src="${escapeHTML(asset.src)}" alt="${escapeHTML(asset.alt)}"${dims} loading="lazy" decoding="async">`;
    }
    if (videoID) mediaHTML += `<span class="embed-card__play" aria-hidden="true">▶</span>`;
  }

  // A default (non-inline) YouTube card's thumbnail and ▶ glyph go *inside* the permalink
  // rather than beside it. Spec §5 asks for "a link to the video with a play affordance", and
  // a thumbnail carrying a play glyph that isn't itself the link is precisely the obvious
  // click target failing to be clickable. Every other card renders its media in place.
  const thumbnail = videoID ? mediaHTML : "";
  if (!thumbnail && mediaHTML) parts.push(mediaHTML);

  const time = snap.publishedAt
    ? `<time class="dt-published" datetime="${escapeHTML(snap.publishedAt)}">${escapeHTML(snap.publishedAt.slice(0, 10))}</time>`
    : "";
  const permalinkInner = `${thumbnail}${time || "View original"}`;
  const permalinkClass = `embed-card__permalink${thumbnail ? " embed-card__permalink--thumbnail" : ""}${cite ? " u-url" : ""}`;
  parts.push(
    isSafeHref(snap.url)
      ? `<a class="${permalinkClass}" href="${escapeHTML(snap.url)}" rel="noopener noreferrer">${permalinkInner}</a>`
      : `<span class="${permalinkClass}">${permalinkInner}</span>`,
  );

  return `<div class="${rootClass}">${parts.join("")}</div>`;
}
