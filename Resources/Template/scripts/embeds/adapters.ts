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
  } else if (stripLeadingWWW(host) === "youtu.be") {
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
  if (stripLeadingWWW(host) === "bsky.app") {
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
  // structurally: /@<user>/<numeric status id> is the universal permalink shape.
  const masto = path.match(/^\/@[^/]+\/(\d+)$/);
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
