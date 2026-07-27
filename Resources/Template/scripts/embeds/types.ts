/**
 * The single normalized shape every platform adapter converges on. The card renderer only
 * ever sees this, so adding a platform means writing one adapter and changing nothing else.
 *
 * Privacy invariant: in a *written* snapshot, `author.avatar` and every `media[].src` are
 * repo-relative paths beginning "/embeds/" — never a remote URL. Hotlinked media would leak
 * each visitor's IP and Referer to the platform, which is the tracking ADR-0008 exists to
 * prevent. `scripts/pre-deploy-check.ts` enforces this on built output.
 */
export type EmbedProvider = "x" | "bluesky" | "mastodon" | "youtube" | "opengraph";

export interface EmbedAsset {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface EmbedAuthor {
  name: string;
  handle?: string;
  url?: string;
  avatar?: string;
}

export interface EmbedSnapshot {
  version: 1;
  url: string;
  provider: EmbedProvider;
  author: EmbedAuthor;
  /** Plain text, never HTML. Escaped at render time — platform post text is untrusted. */
  content: string;
  publishedAt?: string;
  media: EmbedAsset[];
  capturedAt: string;
}
