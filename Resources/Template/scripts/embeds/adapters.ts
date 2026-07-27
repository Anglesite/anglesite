import type { EmbedProvider } from "./types";

export interface AdapterRequest {
  provider: EmbedProvider;
  /** Normalized permalink — the snapshot's identity and slug input. */
  canonicalURL: string;
  /** Where the snapshotter fetches from. For opengraph this is the page itself. */
  apiURL: string;
}

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"]);
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
// Named rather than inlined because each is matched twice — once in its own branch and once in
// the Mastodon guard below, which is safety-critical. A literal in only one of the two places
// would silently stop guarding the moment the other was edited.
const YOUTU_BE_HOST = "youtu.be";
const BSKY_HOST = "bsky.app";

function stripLeadingWWW(host: string): string {
  return host.replace(/^www\./, "");
}

/**
 * Resolve a raw URL to the adapter that should snapshot it. Returns null only for input that
 * isn't an http(s) URL at all — anything else falls back to the generic Open Graph adapter,
 * which is why an unsupported platform degrades to a link card rather than an error.
 */
export function resolveAdapter(rawURL: string): AdapterRequest | null {
  let u: URL;
  try {
    u = new URL(rawURL);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");

  // X / Twitter: /<handle>/status/<id>
  if (X_HOSTS.has(host)) {
    const m = path.match(/^\/([A-Za-z0-9_]+)\/status(?:es)?\/(\d+)$/);
    if (m) {
      const canonicalURL = `https://x.com/${m[1]}/status/${m[2]}`;
      return {
        provider: "x",
        canonicalURL,
        // dnt=true asks X not to associate the request with a user; omit_script drops the
        // widget loader we would never ship anyway.
        apiURL: `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonicalURL)}&omit_script=true&dnt=true`,
      };
    }
  }

  // YouTube: watch?v=, youtu.be/<id>, /shorts/<id>
  let videoId: string | null = null;
  if (YT_HOSTS.has(host)) {
    videoId = u.searchParams.get("v") ?? path.match(/^\/shorts\/([A-Za-z0-9_-]{6,})$/)?.[1] ?? null;
  } else if (stripLeadingWWW(host) === YOUTU_BE_HOST) {
    videoId = path.match(/^\/([A-Za-z0-9_-]{6,})$/)?.[1] ?? null;
  }
  if (videoId) {
    const canonicalURL = `https://www.youtube.com/watch?v=${videoId}`;
    return {
      provider: "youtube",
      canonicalURL,
      apiURL: `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalURL)}&format=json`,
    };
  }

  // Bluesky: /profile/<actor>/post/<rkey>
  if (stripLeadingWWW(host) === BSKY_HOST) {
    const m = path.match(/^\/profile\/([^/]+)\/post\/([^/]+)$/);
    if (m) {
      const atURI = `at://${m[1]}/app.bsky.feed.post/${m[2]}`;
      return {
        provider: "bluesky",
        canonicalURL: `https://bsky.app/profile/${m[1]}/post/${m[2]}`,
        apiURL:
          `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread` +
          `?uri=${encodeURIComponent(atURI)}&depth=0&parentHeight=0`,
      };
    }
  }

  // Mastodon is federated — there is no host allowlist to match against, so detect it
  // structurally: /@<user>/<numeric status id> is the universal permalink shape. But that
  // shape isn't unique to Mastodon (e.g. a blog with /@user/<numeric-id> permalinks), so
  // guard it against hosts we already know belong to a different provider — otherwise a
  // matching path on X, YouTube, or Bluesky would be misrouted to a Mastodon API call
  // instead of falling through to the opengraph fallback below. Do not drop this guard.
  const isKnownOtherHost =
    X_HOSTS.has(host) ||
    YT_HOSTS.has(host) ||
    stripLeadingWWW(host) === YOUTU_BE_HOST ||
    stripLeadingWWW(host) === BSKY_HOST;
  const masto = isKnownOtherHost ? null : path.match(/^\/@[^/]+\/(\d+)$/);
  if (masto) {
    return {
      provider: "mastodon",
      canonicalURL: `${u.origin}${path}`,
      apiURL: `${u.origin}/api/v1/statuses/${masto[1]}`,
    };
  }

  const canonicalURL = `${u.origin}${path}${u.search}`;
  return { provider: "opengraph", canonicalURL, apiURL: canonicalURL };
}

/**
 * The key a snapshot is stored and looked up under. **Every** producer and consumer of the
 * snapshot map must derive its key through this function, or the two sides disagree and a
 * perfectly good snapshot silently never renders.
 *
 * That is not a hypothetical: `resolveAdapter` strips the tracking parameters a platform's own
 * "Copy link" button appends (`?s=20&t=…`, `?utm_*`), rewrites `youtu.be/<id>` and
 * `twitter.com/…` to their canonical forms, and drops trailing slashes. So the URL an owner
 * actually pastes into a post is routinely *not* the URL the snapshot was written under.
 * Normalizing both the stored key (`loadAllSnapshots`) and the lookup (the remark plugin and
 * `Hentry.astro`) makes every one of those spellings resolve to the same snapshot — including
 * a trailing slash in either direction, which `integrations/docs/embeds-setup.md` promises.
 *
 * Falls back to the raw string for input `resolveAdapter` rejects (not an http(s) URL), so a
 * hand-authored snapshot with an unusual `url` is still addressable by its exact spelling.
 */
export function snapshotKey(rawURL: string): string {
  return resolveAdapter(rawURL)?.canonicalURL ?? rawURL;
}
