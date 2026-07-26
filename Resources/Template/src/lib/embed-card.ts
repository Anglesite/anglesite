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
  /** Opt in to a click-to-load youtube-nocookie iframe (EMBED_VIDEO_INLINE=true). */
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
    snap.author.url
      ? `<a class="${authorClass}" href="${escapeHTML(snap.author.url)}" rel="noopener noreferrer">${authorInner}</a>`
      : `<span class="${authorClass}">${authorInner}</span>`,
  );

  if (snap.content) {
    parts.push(`<p class="embed-card__text${cite ? " p-content" : ""}">${escapeHTML(snap.content)}</p>`);
  }

  const videoID = snap.provider === "youtube" ? youTubeID(snap.url) : null;
  if (options.inlineVideo && videoID) {
    // Click-to-load is the browser's own lazy-loading: no youtube-nocookie request is made
    // until the frame scrolls into view, and none at all if the visitor never gets there.
    parts.push(
      `<iframe class="embed-card__video" src="https://www.youtube-nocookie.com/embed/${escapeHTML(videoID)}" ` +
        `title="${escapeHTML(snap.content)}" loading="lazy" allowfullscreen ` +
        `referrerpolicy="no-referrer" frameborder="0"></iframe>`,
    );
  } else {
    for (const asset of snap.media) {
      if (!isLocalAsset(asset.src)) continue;
      const dims = `${asset.width ? ` width="${asset.width}"` : ""}${asset.height ? ` height="${asset.height}"` : ""}`;
      parts.push(
        `<img class="embed-card__media" src="${escapeHTML(asset.src)}" alt="${escapeHTML(asset.alt)}"${dims} loading="lazy" decoding="async">`,
      );
    }
    if (videoID) parts.push(`<span class="embed-card__play" aria-hidden="true">▶</span>`);
  }

  const time = snap.publishedAt
    ? `<time class="dt-published" datetime="${escapeHTML(snap.publishedAt)}">${escapeHTML(snap.publishedAt.slice(0, 10))}</time>`
    : "";
  parts.push(
    `<a class="embed-card__permalink${cite ? " u-url" : ""}" href="${escapeHTML(snap.url)}" rel="noopener noreferrer">${time || "View original"}</a>`,
  );

  return `<div class="${rootClass}">${parts.join("")}</div>`;
}
