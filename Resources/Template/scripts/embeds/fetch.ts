import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AdapterRequest } from "./adapters";
import type { EmbedProvider, EmbedSnapshot } from "./types";
import { assetFilename, mediaDir, MEDIA_DIR } from "./store";
import { assertPublicURL, type HostLookup } from "./net-guard";
import {
  hasOpenGraphMetadata,
  normalizeBluesky,
  normalizeMastodon,
  normalizeOpenGraph,
  normalizeX,
  normalizeYouTube,
} from "./normalize";

/** Refuse to commit anything larger than this into the owner's site repo. */
export const MAX_ASSET_BYTES = 5_000_000;

const USER_AGENT = "Anglesite-EmbedSnapshot/1.0 (+https://github.com/Anglesite/Anglesite)";
const TIMEOUT_MS = 15_000;

export function normalizeFor(
  provider: EmbedProvider,
  raw: unknown,
  canonicalURL: string,
  capturedAt: string,
  /** The URL the payload was actually fetched from — only consulted for opengraph. */
  fetchedURL: string = canonicalURL,
): EmbedSnapshot {
  switch (provider) {
    case "x": return normalizeX(raw, canonicalURL, capturedAt);
    case "youtube": return normalizeYouTube(raw, canonicalURL, capturedAt);
    case "bluesky": return normalizeBluesky(raw, canonicalURL, capturedAt);
    case "mastodon": return normalizeMastodon(raw, canonicalURL, capturedAt);
    case "opengraph": return normalizeOpenGraph(String(raw), canonicalURL, capturedAt, fetchedURL);
  }
}

/** Redirect hops to follow before giving up. Matches the browser convention. */
const MAX_REDIRECTS = 20;

/**
 * Fetch one URL, refusing any hop whose host is or resolves to a private address.
 *
 * Redirects are followed manually (`redirect: "manual"`) rather than by the runtime, because
 * `redirect: "follow"` would validate only the URL we started with — a public page can redirect
 * to `169.254.169.254`, and the guard has to see every hop to be worth anything.
 */
async function get(
  url: string,
  fetchImpl: typeof fetch,
  accept: string,
  lookup?: HostLookup,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicURL(current, lookup);
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers: { accept, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location === null) {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${current}`);
      return response;
    }
    // Resolve relative redirect targets against the hop they came from.
    current = new URL(location, current).href;
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS}) starting at ${url}`);
}

/**
 * Fetch and normalize one embed. This function and `downloadAssets` are the only network code
 * in the feature — the build never calls either.
 */
export async function fetchSnapshot(
  request: AdapterRequest,
  capturedAt: string,
  fetchImpl: typeof fetch = fetch,
  lookup?: HostLookup,
): Promise<EmbedSnapshot> {
  const wantsHTML = request.provider === "opengraph";
  const response = await get(
    request.apiURL,
    fetchImpl,
    wantsHTML ? "text/html,application/xhtml+xml" : "application/json",
    lookup,
  );
  const raw: unknown = wantsHTML ? await response.text() : await response.json();
  // A 200 with no `og:*` tags at all (Instagram, reliably) never throws on its own, but
  // `normalizeOpenGraph`'s <title>-fallback would still turn it into a "successful" snapshot
  // with junk content. Treat "no Open Graph metadata published" as a failure here instead,
  // so callers get the same failure path as any other unreadable response.
  if (wantsHTML && !hasOpenGraphMetadata(raw as string)) {
    throw new Error(`no Open Graph metadata found at ${request.canonicalURL}`);
  }
  // `response.url` is the page as actually retrieved (post-redirect) — e.g. a server that
  // redirects the slash-less `request.apiURL` to a trailing-slash canonical form. Falls back
  // to `apiURL` for a Response with no url (a hand-built Response in tests, or a runtime that
  // doesn't populate it), which matches pre-fix behavior exactly.
  const fetchedURL = response.url || request.apiURL;
  return normalizeFor(request.provider, raw, request.canonicalURL, capturedAt, fetchedURL);
}

/**
 * Download every remote asset into `public/embeds/<slug>/`, returning remote URL → repo-relative
 * path. A failed or oversized asset is simply absent from the map; `localizeAssets` then drops
 * that reference rather than leaving it pointing at the platform CDN.
 */
export async function downloadAssets(
  urls: readonly string[],
  cwd: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
  lookup?: HostLookup,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (urls.length === 0) return map;
  const dir = mediaDir(cwd, slug);
  mkdirSync(dir, { recursive: true });

  for (const [index, url] of urls.entries()) {
    const filename = assetFilename(url, index);
    try {
      const response = await get(url, fetchImpl, "image/*", lookup);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        console.error(`  skipped ${url} — ${bytes.byteLength} bytes exceeds the ${MAX_ASSET_BYTES}-byte cap`);
        continue;
      }
      writeFileSync(resolve(dir, filename), bytes);
      map[url] = `/${MEDIA_DIR.replace(/^public\//, "")}/${slug}/${filename}`;
    } catch (error) {
      console.error(`  skipped ${url} — ${(error as Error).message}`);
    }
  }
  return map;
}
