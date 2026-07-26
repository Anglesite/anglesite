# Privacy-Preserving Embeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site owner embed a post from X, Bluesky, Mastodon, YouTube, or any URL by snapshotting it once into their own git repo and rendering it as a first-party card, with zero third-party JavaScript and zero third-party image requests.

**Architecture:** A CLI (`scripts/embed-snapshot.ts`) is the only thing that touches the network. It resolves a URL to a platform adapter, fetches, normalizes to a single `EmbedSnapshot` shape, downloads the media, and writes `src/embeds/<slug>.json` + `public/embeds/<slug>/*`. At build time a remark plugin swaps a bare-URL paragraph for card HTML read from that committed store; `Hentry.astro` does the same for IndieWeb reply context. Builds never make a network request.

**Tech Stack:** TypeScript (ES modules), Astro 6, `node:test` via `tsx`, no new runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-07-25-privacy-preserving-embeds-design.md`](../specs/2026-07-25-privacy-preserving-embeds-design.md)

## Global Constraints

- **No new dependencies.** `AGENTS.md` ▸ Code guidelines requires explicit approval in an issue first. Everything here uses `node:` builtins, Astro's existing pipeline, and hand-written parsers. The plan *removes* one dependency (`astro-embed`) and adds none.
- **All paths are relative to `Resources/Template/`** unless stated otherwise. The repo root is the worktree root.
- **ES modules only** (`import`/`export`), vanilla APIs, existing tsc toolchain.
- **`EmbedSnapshot.version` is `1`.** Any shape change is a new version, never a silent reinterpretation.
- **`author.avatar` and `media[].src` in a written snapshot are always repo-relative paths beginning `/embeds/`** — never a remote URL. This is the invariant the whole privacy claim rests on; Task 9's pre-deploy rule enforces it in built output.
- **Snapshot slug** = first 12 hex chars of `sha256(canonicalURL)`.
- **Post text is untrusted input.** It is stored as plain text and HTML-escaped at render time. Never interpolate it raw.
- **Test convention:** `node:test` + `node:assert/strict`, run with `npx tsx --test`. `vitest` stays worker-only. No test may make a network request.
- **Commit format:** conventional commits, subject ≤72 chars, referencing `#682`.

## Design refinement made while planning (deviates from spec §4.1)

The spec's module table implies `EmbedCard.astro` is the renderer. It cannot be, for two reasons discovered while planning:

1. A remark plugin must emit an **HTML string** (an mdast `html` node) — it cannot instantiate an Astro component.
2. Astro's scoped `<style>` does **not** apply to markup injected via `set:html`, so a scoped style in `EmbedCard.astro` would style the reply-context card but silently miss every in-body card.

So: `src/lib/embed-card.ts` exports `renderEmbedCard()` returning an HTML string — one renderer, used by both the remark plugin and the component. `EmbedCard.astro` is a thin `set:html` wrapper. Card CSS lives in `src/styles/global.css` under a `.embed-card` namespace, not in a scoped block. Everything else in the spec stands.

---

### Task 1: Make the `scripts/` test suites actually run, and drop `astro-embed`

**Why this is first:** `Resources/Template/vitest.config.ts` includes only `worker/**/*.test.ts`, and the CI template lane (`.github/workflows/ci.yml`, job `template-worker`) runs only `npm run test:worker` and `npm run build`. The nine existing `scripts/*.test.ts` suites — `csp`, `config`, `themes`, `microformats`, `redirects`, `pre-deploy-check`, `keystatic-gate`, `component-harness`, `edge-artifacts` — **run nowhere in CI today**. Every test written in Tasks 2-9 would be equally unenforced. Fix the harness before relying on it.

**Files:**
- Modify: `Resources/Template/package.json`
- Modify: `.github/workflows/ci.yml` (job `template-worker`, after the `npm run test:worker` step)

- [ ] **Step 1: Confirm the gap is real**

Run from `Resources/Template/`:

```bash
npm run test:worker -- --reporter=basic 2>&1 | grep -c "scripts/"
```

Expected: `0` — no `scripts/` test file is picked up by vitest.

- [ ] **Step 2: Add the `test:scripts` npm script**

In `Resources/Template/package.json`, add to `"scripts"` immediately after `"test:worker"`:

```json
    "test:scripts": "tsx --test scripts/*.test.ts",
```

**Why an explicit glob per directory rather than `**`:** npm scripts run under `sh` on Linux CI, where `**` degrades to a single `*` — `scripts/**/*.test.ts` would silently skip the nine top-level suites this task exists to enable. A quoted globstar doesn't help either: verified that `tsx --test "scripts/**/*.test.ts"` collects **zero** tests, and that passing a directory (`tsx --test scripts`) fails outright because tsx tries to import it as a module. Tasks 2 and 6 each extend this list when they add a test directory.

- [ ] **Step 3: Remove the unused `astro-embed` dependency**

In `Resources/Template/package.json`, delete this line from `"dependencies"`:

```json
    "astro-embed": "^0.13.0",
```

It is imported nowhere in `Resources/Template/`, `Sources/`, `scripts/`, or `project.yml`. Its build-time fetching contradicts spec §3's fetch policy, so nothing later in this plan will adopt it.

- [ ] **Step 4: Refresh the lockfile**

Run from `Resources/Template/`:

```bash
npm install --package-lock-only --no-audit --no-fund
```

- [ ] **Step 5: Verify the suites now run and pass**

Run from `Resources/Template/`:

```bash
npm run test:scripts
```

Expected: PASS — measured on 2026-07-25 at `tests 146`, `pass 144`, `fail 0` (two are conditionally skipped). If the count differs, that's fine; `fail 0` is the gate. If anything actually fails, stop — it is a pre-existing break this task has just surfaced, and it must be fixed or triaged before the rest of the plan relies on this harness.

- [ ] **Step 6: Add the CI step**

In `.github/workflows/ci.yml`, in the `template-worker` job, insert between the `npm run test:worker` and `npm run build` steps:

```yaml
      - run: npm run test:scripts
```

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/package.json Resources/Template/package-lock.json .github/workflows/ci.yml
git commit -m "test(#682): run template scripts/ suites in CI; drop astro-embed"
```

---

### Task 2: `EmbedSnapshot` type and URL → adapter resolution

**Files:**
- Create: `Resources/Template/scripts/embeds/types.ts`
- Create: `Resources/Template/scripts/embeds/adapters.ts`
- Test: `Resources/Template/scripts/embeds/adapters.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type EmbedProvider = "x" | "bluesky" | "mastodon" | "youtube" | "opengraph"`
  - `interface EmbedAsset { src: string; alt: string; width?: number; height?: number }`
  - `interface EmbedAuthor { name: string; handle?: string; url?: string; avatar?: string }`
  - `interface EmbedSnapshot { version: 1; url: string; provider: EmbedProvider; author: EmbedAuthor; content: string; publishedAt?: string; media: EmbedAsset[]; capturedAt: string }`
  - `interface AdapterRequest { provider: EmbedProvider; canonicalURL: string; apiURL: string }`
  - `function resolveAdapter(rawURL: string): AdapterRequest | null`

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/scripts/embeds/adapters.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdapter } from "./adapters";

test("resolveAdapter: rejects non-http(s) input", () => {
  assert.equal(resolveAdapter("mailto:me@example.com"), null);
  assert.equal(resolveAdapter("not a url"), null);
});

test("resolveAdapter: x.com and twitter.com resolve identically", () => {
  const a = resolveAdapter("https://twitter.com/jack/status/20");
  const b = resolveAdapter("https://x.com/jack/status/20");
  assert.equal(a?.provider, "x");
  assert.equal(a?.canonicalURL, "https://x.com/jack/status/20");
  assert.deepEqual(a, b);
});

test("resolveAdapter: x mobile host and query string normalize away", () => {
  const r = resolveAdapter("https://mobile.twitter.com/jack/status/20?s=20&t=abc");
  assert.equal(r?.canonicalURL, "https://x.com/jack/status/20");
  assert.match(r?.apiURL ?? "", /^https:\/\/publish\.twitter\.com\/oembed\?/);
  assert.match(r?.apiURL ?? "", /dnt=true/);
});

test("resolveAdapter: youtu.be short form and shorts normalize to watch URL", () => {
  for (const input of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
  ]) {
    const r = resolveAdapter(input);
    assert.equal(r?.provider, "youtube", input);
    assert.equal(r?.canonicalURL, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", input);
  }
});

test("resolveAdapter: bluesky builds an at:// URI for the public API", () => {
  const r = resolveAdapter("https://bsky.app/profile/did:plc:abc123/post/3juvfg");
  assert.equal(r?.provider, "bluesky");
  assert.match(r?.apiURL ?? "", /getPostThread\?uri=at%3A%2F%2Fdid%3Aplc%3Aabc123%2Fapp\.bsky\.feed\.post%2F3juvfg/);
});

test("resolveAdapter: mastodon is detected structurally, on any instance host", () => {
  const r = resolveAdapter("https://mastodon.social/@Gargron/109252195886");
  assert.equal(r?.provider, "mastodon");
  assert.equal(r?.apiURL, "https://mastodon.social/api/v1/statuses/109252195886");
});

test("resolveAdapter: unknown host falls back to opengraph, scraping the page itself", () => {
  const r = resolveAdapter("https://example.com/some/post");
  assert.equal(r?.provider, "opengraph");
  assert.equal(r?.canonicalURL, "https://example.com/some/post");
  assert.equal(r?.apiURL, "https://example.com/some/post");
});

test("resolveAdapter: an x profile URL is not a post, so it degrades to opengraph", () => {
  assert.equal(resolveAdapter("https://x.com/jack")?.provider, "opengraph");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `Resources/Template/`:

```bash
npx tsx --test scripts/embeds/adapters.test.ts
```

Expected: FAIL — `Cannot find module './adapters'`.

- [ ] **Step 3: Write the types**

Create `Resources/Template/scripts/embeds/types.ts`:

```ts
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
```

- [ ] **Step 4: Write the adapters**

Create `Resources/Template/scripts/embeds/adapters.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run from `Resources/Template/`:

```bash
npx tsx --test scripts/embeds/adapters.test.ts
```

Expected: PASS, `fail 0`, 8 tests.

- [ ] **Step 6: Extend `test:scripts` to cover the new directory**

`scripts/*.test.ts` does not match `scripts/embeds/*.test.ts` (see Task 1 Step 2). In `Resources/Template/package.json`, change the `test:scripts` value to:

```json
    "test:scripts": "tsx --test scripts/*.test.ts scripts/embeds/*.test.ts",
```

- [ ] **Step 7: Verify the whole suite runs**

```bash
npm run test:scripts
```

Expected: PASS, `fail 0`, and a test count ~8 higher than Task 1's run — proving the new file is actually collected and not silently skipped.

- [ ] **Step 8: Commit**

```bash
git add Resources/Template/scripts/embeds/ Resources/Template/package.json
git commit -m "feat(#682): embed snapshot types and URL adapter resolution"
```

---

### Task 3: Normalize each platform's payload into `EmbedSnapshot`

**Files:**
- Create: `Resources/Template/scripts/embeds/normalize.ts`
- Create: `Resources/Template/scripts/embeds/fixtures/x-oembed.json`
- Create: `Resources/Template/scripts/embeds/fixtures/bluesky-thread.json`
- Create: `Resources/Template/scripts/embeds/fixtures/mastodon-status.json`
- Create: `Resources/Template/scripts/embeds/fixtures/youtube-oembed.json`
- Create: `Resources/Template/scripts/embeds/fixtures/opengraph.html`
- Test: `Resources/Template/scripts/embeds/normalize.test.ts`

**Interfaces:**
- Consumes: `EmbedSnapshot`, `EmbedAsset` from `./types`.
- Produces:
  - `function htmlToText(html: string): string`
  - `function normalizeX(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot`
  - `function normalizeYouTube(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot`
  - `function normalizeBluesky(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot`
  - `function normalizeMastodon(payload: unknown, canonicalURL: string, capturedAt: string): EmbedSnapshot`
  - `function normalizeOpenGraph(html: string, canonicalURL: string, capturedAt: string): EmbedSnapshot`

At this stage `author.avatar` and `media[].src` still hold **remote** URLs. Task 4's `localizeAssets` rewrites them to `/embeds/…` paths after download. That split is what keeps normalization pure.

- [ ] **Step 1: Create the fixtures**

These are trimmed real responses. Create `Resources/Template/scripts/embeds/fixtures/x-oembed.json`:

```json
{
  "url": "https://x.com/jack/status/20",
  "author_name": "jack",
  "author_url": "https://x.com/jack",
  "html": "<blockquote class=\"twitter-tweet\"><p lang=\"en\" dir=\"ltr\">just setting up my twttr</p>&mdash; jack (@jack) <a href=\"https://x.com/jack/status/20?ref_src=twsrc%5Etfw\">March 21, 2006</a></blockquote>\n\n",
  "type": "rich",
  "provider_name": "X"
}
```

Create `Resources/Template/scripts/embeds/fixtures/youtube-oembed.json`:

```json
{
  "title": "Never Gonna Give You Up",
  "author_name": "Rick Astley",
  "author_url": "https://www.youtube.com/@RickAstleyYT",
  "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "thumbnail_width": 480,
  "thumbnail_height": 360,
  "provider_name": "YouTube"
}
```

Create `Resources/Template/scripts/embeds/fixtures/bluesky-thread.json`:

```json
{
  "thread": {
    "post": {
      "uri": "at://did:plc:abc123/app.bsky.feed.post/3juvfg",
      "author": {
        "did": "did:plc:abc123",
        "handle": "example.bsky.social",
        "displayName": "Example Person",
        "avatar": "https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/bafkrei@jpeg"
      },
      "record": { "text": "hello from the open network", "createdAt": "2026-03-04T10:11:12.000Z" },
      "embed": {
        "$type": "app.bsky.embed.images#view",
        "images": [
          {
            "thumb": "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc123/bafthumb@jpeg",
            "fullsize": "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc123/baffull@jpeg",
            "alt": "A photo of a sunset",
            "aspectRatio": { "width": 1200, "height": 800 }
          }
        ]
      }
    }
  }
}
```

Create `Resources/Template/scripts/embeds/fixtures/mastodon-status.json`:

```json
{
  "id": "109252195886",
  "created_at": "2026-02-01T09:00:00.000Z",
  "url": "https://mastodon.social/@Gargron/109252195886",
  "content": "<p>Hello <a href=\"https://mastodon.social/tags/fediverse\">#fediverse</a>&nbsp;&mdash; testing &amp; such.</p>",
  "account": {
    "display_name": "Eugen",
    "acct": "Gargron",
    "url": "https://mastodon.social/@Gargron",
    "avatar": "https://files.mastodon.social/accounts/avatars/original.png"
  },
  "media_attachments": [
    {
      "type": "image",
      "url": "https://files.mastodon.social/media_attachments/files/original.jpg",
      "description": "A screenshot",
      "meta": { "original": { "width": 1000, "height": 500 } }
    }
  ]
}
```

Create `Resources/Template/scripts/embeds/fixtures/opengraph.html`:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Fallback title that should lose to og:title</title>
<meta property="og:title" content="A Post On Some Blog">
<meta property="og:description" content="Summary of the post &amp; its contents.">
<meta property="og:image" content="https://example.com/card.png">
<meta property="og:site_name" content="Some Blog">
</head>
<body><p>hi</p></body>
</html>
```

- [ ] **Step 2: Write the failing test**

Create `Resources/Template/scripts/embeds/normalize.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  htmlToText,
  normalizeX,
  normalizeYouTube,
  normalizeBluesky,
  normalizeMastodon,
  normalizeOpenGraph,
} from "./normalize";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(here, "fixtures", name), "utf-8");
const json = (name: string) => JSON.parse(fixture(name));

const AT = "2026-07-25T00:00:00.000Z";

test("htmlToText: strips tags and decodes the entities platforms actually emit", () => {
  assert.equal(htmlToText("<p>a &amp; b</p>"), "a & b");
  assert.equal(htmlToText("x&nbsp;&mdash;&nbsp;y"), "x — y");
  assert.equal(htmlToText("<p>one</p><p>two</p>"), "one\n\ntwo");
  assert.equal(htmlToText("&lt;script&gt;"), "<script>");
});

test("normalizeX: extracts text, author, handle and date from the oEmbed blockquote", () => {
  const s = normalizeX(json("x-oembed.json"), "https://x.com/jack/status/20", AT);
  assert.equal(s.version, 1);
  assert.equal(s.provider, "x");
  assert.equal(s.content, "just setting up my twttr");
  assert.equal(s.author.name, "jack");
  assert.equal(s.author.handle, "@jack");
  assert.equal(s.author.url, "https://x.com/jack");
  assert.equal(s.publishedAt, new Date("March 21, 2006").toISOString());
  // X's oEmbed carries no avatar and no media — the card must cope with that.
  assert.equal(s.author.avatar, undefined);
  assert.deepEqual(s.media, []);
  assert.equal(s.capturedAt, AT);
});

test("normalizeYouTube: title becomes content, thumbnail becomes the sole media asset", () => {
  const s = normalizeYouTube(json("youtube-oembed.json"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ", AT);
  assert.equal(s.provider, "youtube");
  assert.equal(s.content, "Never Gonna Give You Up");
  assert.equal(s.author.name, "Rick Astley");
  assert.deepEqual(s.media, [
    { src: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", alt: "Never Gonna Give You Up", width: 480, height: 360 },
  ]);
});

test("normalizeBluesky: reads record text, avatar and image aspect ratio", () => {
  const s = normalizeBluesky(json("bluesky-thread.json"), "https://bsky.app/profile/did:plc:abc123/post/3juvfg", AT);
  assert.equal(s.provider, "bluesky");
  assert.equal(s.content, "hello from the open network");
  assert.equal(s.author.name, "Example Person");
  assert.equal(s.author.handle, "@example.bsky.social");
  assert.equal(s.publishedAt, "2026-03-04T10:11:12.000Z");
  assert.equal(s.author.avatar, "https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/bafkrei@jpeg");
  assert.equal(s.media.length, 1);
  assert.equal(s.media[0].alt, "A photo of a sunset");
  assert.equal(s.media[0].width, 1200);
});

test("normalizeMastodon: converts content HTML to text and keeps attachments", () => {
  const s = normalizeMastodon(json("mastodon-status.json"), "https://mastodon.social/@Gargron/109252195886", AT);
  assert.equal(s.provider, "mastodon");
  assert.equal(s.content, "Hello #fediverse — testing & such.");
  assert.equal(s.author.handle, "@Gargron");
  assert.equal(s.media[0].src, "https://files.mastodon.social/media_attachments/files/original.jpg");
  assert.equal(s.media[0].height, 500);
});

test("normalizeOpenGraph: og:title beats <title>, og:image becomes media", () => {
  const s = normalizeOpenGraph(fixture("opengraph.html"), "https://example.com/some/post", AT);
  assert.equal(s.provider, "opengraph");
  assert.equal(s.author.name, "Some Blog");
  assert.equal(s.content, "A Post On Some Blog — Summary of the post & its contents.");
  assert.deepEqual(s.media, [{ src: "https://example.com/card.png", alt: "A Post On Some Blog" }]);
});

test("normalizers degrade on partial payloads instead of throwing", () => {
  const empty = normalizeX({}, "https://x.com/a/status/1", AT);
  assert.equal(empty.content, "");
  assert.equal(empty.author.name, "x.com");
  assert.deepEqual(normalizeBluesky({}, "https://bsky.app/x", AT).media, []);
  assert.equal(normalizeMastodon({ account: null }, "https://m.example/@a/1", AT).content, "");
  assert.equal(normalizeOpenGraph("<html></html>", "https://example.com/p", AT).content, "");
});

test("normalizers never throw on a hostile payload", () => {
  const hostile = { author_name: "<img src=x onerror=alert(1)>", html: "<p><script>alert(1)</script></p>" };
  const s = normalizeX(hostile, "https://x.com/a/status/1", AT);
  // Stored as plain text; escaping is the renderer's job (Task 6), not the normalizer's.
  assert.equal(s.content, "alert(1)");
  assert.equal(s.author.name, "<img src=x onerror=alert(1)>");
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx tsx --test scripts/embeds/normalize.test.ts
```

Expected: FAIL — `Cannot find module './normalize'`.

- [ ] **Step 4: Write the normalizers**

Create `Resources/Template/scripts/embeds/normalize.ts`:

```ts
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
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|blockquote)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
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

/** ISO-8601 or undefined — never an Invalid Date, which would serialize as null. */
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

export function normalizeOpenGraph(html: string, canonicalURL: string, capturedAt: string): EmbedSnapshot {
  const snap = base("opengraph", canonicalURL, capturedAt);
  const title = metaContent(html, "og:title") ?? htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = metaContent(html, "og:description") ?? "";
  snap.content = [title, description].filter((s) => s.length > 0).join(" — ");
  const siteName = metaContent(html, "og:site_name");
  if (siteName) snap.author.name = siteName;
  const image = metaContent(html, "og:image");
  if (image) snap.media.push({ src: image, alt: title });
  return snap;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx tsx --test scripts/embeds/normalize.test.ts
```

Expected: PASS, `fail 0`, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/scripts/embeds/
git commit -m "feat(#682): normalize platform payloads to EmbedSnapshot"
```

---

### Task 4: Snapshot store — slug, asset localization, read/write

**Files:**
- Create: `Resources/Template/scripts/embeds/store.ts`
- Test: `Resources/Template/scripts/embeds/store.test.ts`

**Interfaces:**
- Consumes: `EmbedSnapshot` from `./types`.
- Produces:
  - `const SNAPSHOT_DIR = "src/embeds"` and `const MEDIA_DIR = "public/embeds"`
  - `function embedSlug(canonicalURL: string): string`
  - `function collectRemoteAssets(snap: EmbedSnapshot): string[]`
  - `function assetFilename(remoteURL: string, index: number): string`
  - `function localizeAssets(snap: EmbedSnapshot, map: Record<string, string>): EmbedSnapshot`
  - `function snapshotPath(cwd: string, slug: string): string`
  - `function mediaDir(cwd: string, slug: string): string`
  - `function writeSnapshot(cwd: string, snap: EmbedSnapshot): string`
  - `function loadAllSnapshots(cwd: string): Map<string, EmbedSnapshot>` — keyed by canonical URL

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/scripts/embeds/store.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbedSnapshot } from "./types";
import {
  embedSlug,
  collectRemoteAssets,
  assetFilename,
  localizeAssets,
  writeSnapshot,
  loadAllSnapshots,
} from "./store";

function sample(): EmbedSnapshot {
  return {
    version: 1,
    url: "https://x.com/jack/status/20",
    provider: "x",
    author: { name: "jack", handle: "@jack", avatar: "https://cdn.example/avatar.jpg" },
    content: "just setting up my twttr",
    media: [{ src: "https://cdn.example/photo.png", alt: "a photo" }],
    capturedAt: "2026-07-25T00:00:00.000Z",
  };
}

test("embedSlug: 12 lowercase hex chars, stable across calls", () => {
  const a = embedSlug("https://x.com/jack/status/20");
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, embedSlug("https://x.com/jack/status/20"));
});

test("embedSlug: different URLs get different slugs", () => {
  assert.notEqual(embedSlug("https://x.com/jack/status/20"), embedSlug("https://x.com/jack/status/21"));
});

test("collectRemoteAssets: gathers avatar and media, skipping already-local paths", () => {
  assert.deepEqual(collectRemoteAssets(sample()), [
    "https://cdn.example/avatar.jpg",
    "https://cdn.example/photo.png",
  ]);
  const local = sample();
  local.author.avatar = "/embeds/abc/avatar.jpg";
  assert.deepEqual(collectRemoteAssets(local), ["https://cdn.example/photo.png"]);
});

test("assetFilename: keeps a sane extension and never escapes its directory", () => {
  assert.equal(assetFilename("https://cdn.example/photo.png", 0), "asset-0.png");
  assert.equal(assetFilename("https://cdn.example/a/b/c.JPEG?x=1", 2), "asset-2.jpeg");
  // No extension, or a hostile one, falls back to .img rather than trusting the URL.
  assert.equal(assetFilename("https://cdn.example/bafkrei@jpeg", 1), "asset-1.img");
  assert.equal(assetFilename("https://cdn.example/x/../../etc/passwd", 3), "asset-3.img");
});

test("localizeAssets: rewrites every remote reference to its repo-relative path", () => {
  const out = localizeAssets(sample(), {
    "https://cdn.example/avatar.jpg": "/embeds/abc123/asset-0.jpg",
    "https://cdn.example/photo.png": "/embeds/abc123/asset-1.png",
  });
  assert.equal(out.author.avatar, "/embeds/abc123/asset-0.jpg");
  assert.equal(out.media[0].src, "/embeds/abc123/asset-1.png");
  assert.equal(out.media[0].alt, "a photo");
});

test("localizeAssets: an unmapped asset is dropped, never left pointing at the platform", () => {
  const out = localizeAssets(sample(), {});
  assert.equal(out.author.avatar, undefined);
  assert.deepEqual(out.media, []);
});

test("localizeAssets: does not mutate its input", () => {
  const input = sample();
  localizeAssets(input, {});
  assert.equal(input.author.avatar, "https://cdn.example/avatar.jpg");
});

test("writeSnapshot then loadAllSnapshots round-trips, keyed by canonical URL", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const snap = localizeAssets(sample(), {});
  const path = writeSnapshot(cwd, snap);
  assert.match(readFileSync(path, "utf-8"), /"version": 1/);
  const all = loadAllSnapshots(cwd);
  assert.equal(all.size, 1);
  assert.equal(all.get("https://x.com/jack/status/20")?.content, "just setting up my twttr");
});

test("writeSnapshot: re-snapshotting the same URL overwrites rather than duplicating", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  writeSnapshot(cwd, localizeAssets(sample(), {}));
  const second = localizeAssets(sample(), {});
  second.content = "edited";
  writeSnapshot(cwd, second);
  const all = loadAllSnapshots(cwd);
  assert.equal(all.size, 1);
  assert.equal(all.get("https://x.com/jack/status/20")?.content, "edited");
});

test("loadAllSnapshots: a missing directory is empty, not an error", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  assert.equal(loadAllSnapshots(cwd).size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test scripts/embeds/store.test.ts
```

Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 3: Write the store**

Create `Resources/Template/scripts/embeds/store.ts`:

```ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EmbedSnapshot } from "./types";

/** Snapshot records live in src/ (committed, not served); their media lives in public/ (served). */
export const SNAPSHOT_DIR = "src/embeds";
export const MEDIA_DIR = "public/embeds";

/** Extensions we are willing to write. Anything else becomes .img rather than trusting the URL. */
const SAFE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]);

/**
 * Stable identity for a snapshot. Must not drift: the slug names committed media paths that
 * end up in built HTML, so a change would orphan every previously-captured asset.
 */
export function embedSlug(canonicalURL: string): string {
  return createHash("sha256").update(canonicalURL).digest("hex").slice(0, 12);
}

function isRemote(src: string | undefined): src is string {
  return typeof src === "string" && /^https?:\/\//i.test(src);
}

/** Every remote URL this snapshot still references, in a stable order (avatar first). */
export function collectRemoteAssets(snap: EmbedSnapshot): string[] {
  const out: string[] = [];
  if (isRemote(snap.author.avatar)) out.push(snap.author.avatar);
  for (const asset of snap.media) if (isRemote(asset.src)) out.push(asset.src);
  return out;
}

/**
 * Index-based filename. Deliberately does not reuse the remote basename: those can contain
 * path traversal, be absent entirely (Bluesky's CIDs), or collide across assets.
 */
export function assetFilename(remoteURL: string, index: number): string {
  let ext = "";
  try {
    ext = new URL(remoteURL).pathname.split(".").pop()?.toLowerCase() ?? "";
  } catch {
    ext = "";
  }
  return SAFE_EXTENSIONS.has(ext) ? `asset-${index}.${ext}` : `asset-${index}.img`;
}

/**
 * Replace every remote asset reference with its downloaded repo-relative path. An asset absent
 * from the map is **dropped**, never left remote — a half-localized snapshot would silently
 * reintroduce the third-party request this whole feature exists to remove.
 */
export function localizeAssets(snap: EmbedSnapshot, map: Record<string, string>): EmbedSnapshot {
  const avatar = snap.author.avatar;
  return {
    ...snap,
    author: {
      ...snap.author,
      avatar: isRemote(avatar) ? map[avatar] : avatar,
    },
    media: snap.media
      .map((asset) => (isRemote(asset.src) ? { ...asset, src: map[asset.src] } : asset))
      .filter((asset): asset is EmbedSnapshot["media"][number] => typeof asset.src === "string"),
  };
}

export function snapshotPath(cwd: string, slug: string): string {
  return resolve(cwd, SNAPSHOT_DIR, `${slug}.json`);
}

export function mediaDir(cwd: string, slug: string): string {
  return resolve(cwd, MEDIA_DIR, slug);
}

export function writeSnapshot(cwd: string, snap: EmbedSnapshot): string {
  const path = snapshotPath(cwd, embedSlug(snap.url));
  mkdirSync(resolve(cwd, SNAPSHOT_DIR), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snap, null, 2)}\n`, "utf-8");
  return path;
}

/**
 * Every committed snapshot, keyed by canonical URL. Called once per build by the remark plugin
 * and by Hentry.astro — reading the directory, never the network.
 */
export function loadAllSnapshots(cwd: string): Map<string, EmbedSnapshot> {
  const dir = resolve(cwd, SNAPSHOT_DIR);
  const out = new Map<string, EmbedSnapshot>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const snap = JSON.parse(readFileSync(join(dir, name), "utf-8")) as EmbedSnapshot;
      if (snap.version === 1 && typeof snap.url === "string") out.set(snap.url, snap);
    } catch {
      // A corrupt snapshot degrades that one embed to a plain link; it must never fail a build.
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test scripts/embeds/store.test.ts
```

Expected: PASS, `fail 0`, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/scripts/embeds/
git commit -m "feat(#682): embed snapshot store, slug and asset localization"
```

---

### Task 5: The snapshotter CLI (the only network code)

**Files:**
- Create: `Resources/Template/scripts/embeds/fetch.ts`
- Create: `Resources/Template/scripts/embed-snapshot.ts`
- Test: `Resources/Template/scripts/embeds/fetch.test.ts`
- Modify: `Resources/Template/package.json` (add the `embed` script)

**Interfaces:**
- Consumes: `resolveAdapter` (Task 2); all normalizers (Task 3); `embedSlug`, `collectRemoteAssets`, `assetFilename`, `localizeAssets`, `writeSnapshot`, `mediaDir` (Task 4).
- Produces:
  - `const MAX_ASSET_BYTES = 5_000_000`
  - `function normalizeFor(provider, raw, canonicalURL, capturedAt): EmbedSnapshot`
  - `async function fetchSnapshot(request: AdapterRequest, capturedAt: string, fetchImpl?: typeof fetch): Promise<EmbedSnapshot>`
  - `async function downloadAssets(urls, dir, slug, fetchImpl?): Promise<Record<string, string>>`

`fetchSnapshot` and `downloadAssets` both take an injectable `fetchImpl` so the tests can exercise them with a stub and **never touch the network**.

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/scripts/embeds/fetch.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAdapter } from "./adapters";
import { fetchSnapshot, downloadAssets, normalizeFor, MAX_ASSET_BYTES } from "./fetch";

const AT = "2026-07-25T00:00:00.000Z";

function jsonResponse(body: unknown, init: { status?: number; type?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "application/json" },
  });
}

test("normalizeFor: dispatches to the right normalizer per provider", () => {
  const s = normalizeFor("youtube", { title: "T" }, "https://www.youtube.com/watch?v=a", AT);
  assert.equal(s.provider, "youtube");
  assert.equal(s.content, "T");
});

test("fetchSnapshot: parses a platform JSON response into a snapshot", async () => {
  const req = resolveAdapter("https://www.youtube.com/watch?v=dQw4w9WgXcQ")!;
  const snap = await fetchSnapshot(req, AT, async () =>
    jsonResponse({ title: "Never Gonna Give You Up", author_name: "Rick Astley" }),
  );
  assert.equal(snap.content, "Never Gonna Give You Up");
  assert.equal(snap.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("fetchSnapshot: opengraph reads HTML, not JSON", async () => {
  const req = resolveAdapter("https://example.com/post")!;
  const snap = await fetchSnapshot(req, AT, async () =>
    new Response('<meta property="og:title" content="Hello">', {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );
  assert.equal(snap.provider, "opengraph");
  assert.equal(snap.content, "Hello");
});

test("fetchSnapshot: a non-OK response throws with the status, not a silent empty card", async () => {
  const req = resolveAdapter("https://www.youtube.com/watch?v=a")!;
  await assert.rejects(
    () => fetchSnapshot(req, AT, async () => jsonResponse({}, { status: 404 })),
    /404/,
  );
});

test("downloadAssets: writes each asset and returns its repo-relative path", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const map = await downloadAssets(
    ["https://cdn.example/a.png", "https://cdn.example/b.jpg"],
    cwd,
    "slug123",
    async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  );
  assert.deepEqual(map, {
    "https://cdn.example/a.png": "/embeds/slug123/asset-0.png",
    "https://cdn.example/b.jpg": "/embeds/slug123/asset-1.jpg",
  });
  assert.ok(existsSync(join(cwd, "public/embeds/slug123/asset-0.png")));
  assert.deepEqual([...readFileSync(join(cwd, "public/embeds/slug123/asset-0.png"))], [1, 2, 3]);
});

test("downloadAssets: a failed asset is omitted from the map, so localizeAssets drops it", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const map = await downloadAssets(
    ["https://cdn.example/gone.png"],
    cwd,
    "slug123",
    async () => new Response("", { status: 404 }),
  );
  assert.deepEqual(map, {});
});

test("downloadAssets: an oversized asset is refused rather than committed to the repo", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const huge = new Uint8Array(MAX_ASSET_BYTES + 1);
  const map = await downloadAssets(
    ["https://cdn.example/huge.png"],
    cwd,
    "slug123",
    async () => new Response(huge, { status: 200 }),
  );
  assert.deepEqual(map, {});
  assert.ok(!existsSync(join(cwd, "public/embeds/slug123/asset-0.png")));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test scripts/embeds/fetch.test.ts
```

Expected: FAIL — `Cannot find module './fetch'`.

- [ ] **Step 3: Write the fetch layer**

Create `Resources/Template/scripts/embeds/fetch.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AdapterRequest } from "./adapters";
import type { EmbedProvider, EmbedSnapshot } from "./types";
import { assetFilename, mediaDir, MEDIA_DIR } from "./store";
import {
  normalizeBluesky,
  normalizeMastodon,
  normalizeOpenGraph,
  normalizeX,
  normalizeYouTube,
} from "./normalize";

/** Refuse to commit anything larger than this into the owner's site repo. */
export const MAX_ASSET_BYTES = 5_000_000;

const USER_AGENT = "Anglesite-EmbedSnapshot/1.0 (+https://github.com/Anglesite/Anglesite-app)";
const TIMEOUT_MS = 15_000;

export function normalizeFor(
  provider: EmbedProvider,
  raw: unknown,
  canonicalURL: string,
  capturedAt: string,
): EmbedSnapshot {
  switch (provider) {
    case "x": return normalizeX(raw, canonicalURL, capturedAt);
    case "youtube": return normalizeYouTube(raw, canonicalURL, capturedAt);
    case "bluesky": return normalizeBluesky(raw, canonicalURL, capturedAt);
    case "mastodon": return normalizeMastodon(raw, canonicalURL, capturedAt);
    case "opengraph": return normalizeOpenGraph(String(raw), canonicalURL, capturedAt);
  }
}

async function get(url: string, fetchImpl: typeof fetch, accept: string): Promise<Response> {
  const response = await fetchImpl(url, {
    redirect: "follow",
    headers: { accept, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response;
}

/**
 * Fetch and normalize one embed. This function and `downloadAssets` are the only network code
 * in the feature — the build never calls either.
 */
export async function fetchSnapshot(
  request: AdapterRequest,
  capturedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbedSnapshot> {
  const wantsHTML = request.provider === "opengraph";
  const response = await get(
    request.apiURL,
    fetchImpl,
    wantsHTML ? "text/html,application/xhtml+xml" : "application/json",
  );
  const raw: unknown = wantsHTML ? await response.text() : await response.json();
  return normalizeFor(request.provider, raw, request.canonicalURL, capturedAt);
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
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (urls.length === 0) return map;
  const dir = mediaDir(cwd, slug);
  mkdirSync(dir, { recursive: true });

  for (const [index, url] of urls.entries()) {
    const filename = assetFilename(url, index);
    try {
      const response = await get(url, fetchImpl, "image/*");
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test scripts/embeds/fetch.test.ts
```

Expected: PASS, `fail 0`, 7 tests.

- [ ] **Step 5: Write the CLI**

Create `Resources/Template/scripts/embed-snapshot.ts`:

```ts
#!/usr/bin/env npx tsx
/**
 * Snapshot a social post into this site's repo so it can be embedded with no third-party
 * JavaScript and no third-party image requests.
 *
 *   npx tsx scripts/embed-snapshot.ts <url> [<url>…]
 *   npx tsx scripts/embed-snapshot.ts --all      # every un-snapshotted URL in src/content/
 *
 * Writes src/embeds/<slug>.json and public/embeds/<slug>/*. Both are meant to be committed:
 * the build reads them and never makes a network request, so an embed keeps rendering even
 * after the platform deletes the post or retires its API.
 *
 * Exit code 0: every requested URL was snapshotted. Exit code 1: at least one failed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAdapter, type AdapterRequest } from "./embeds/adapters";
import { downloadAssets, fetchSnapshot } from "./embeds/fetch";
import { collectRemoteAssets, embedSlug, loadAllSnapshots, localizeAssets, writeSnapshot } from "./embeds/store";

const CONTENT_DIR = "src/content";

/** Bare URLs sitting alone on a line — the same shape the remark plugin turns into a card. */
function bareURLsIn(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (/^<?https?:\/\/\S+>?$/.test(trimmed)) out.push(trimmed.replace(/^<|>$/g, ""));
  }
  return out;
}

function* markdownFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* markdownFiles(full);
    else if (full.endsWith(".md")) yield full;
  }
}

function discoverURLs(cwd: string): string[] {
  const seen = new Set<string>();
  for (const file of markdownFiles(resolve(cwd, CONTENT_DIR))) {
    for (const url of bareURLsIn(readFileSync(file, "utf-8"))) seen.add(url);
  }
  return [...seen];
}

async function capture(cwd: string, request: AdapterRequest, capturedAt: string): Promise<void> {
  const fetched = await fetchSnapshot(request, capturedAt);
  const slug = embedSlug(request.canonicalURL);
  const map = await downloadAssets(collectRemoteAssets(fetched), cwd, slug);
  const path = writeSnapshot(cwd, localizeAssets(fetched, map));
  console.log(`✓ wrote ${path}`);
}

async function snapshot(cwd: string, rawURL: string, capturedAt: string): Promise<boolean> {
  const request = resolveAdapter(rawURL);
  if (!request) {
    console.error(`✗ ${rawURL} — not an http(s) URL`);
    return false;
  }
  console.log(`→ ${request.canonicalURL} (${request.provider})`);
  try {
    await capture(cwd, request, capturedAt);
    return true;
  } catch (error) {
    console.error(`  ${request.provider} adapter failed — ${(error as Error).message}`);
  }

  if (request.provider === "opengraph") {
    console.error(`✗ ${request.canonicalURL} — no Open Graph metadata could be read.`);
    console.error(
      "  If the platform blocks automated requests (Instagram does), snapshot succeeds nowhere:\n" +
        `  save a screenshot to public/embeds/${embedSlug(request.canonicalURL)}/ and add it to\n` +
        "  that snapshot's media[] by hand.",
    );
    return false;
  }

  // Spec §6 step 2: a failed platform adapter degrades to a generic Open Graph link card
  // rather than to nothing. Same canonical URL, so it claims the same slug.
  console.error("  falling back to Open Graph…");
  try {
    await capture(
      cwd,
      { provider: "opengraph", canonicalURL: request.canonicalURL, apiURL: request.canonicalURL },
      capturedAt,
    );
    return true;
  } catch (fallbackError) {
    console.error(`✗ ${request.canonicalURL} — ${(fallbackError as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const capturedAt = new Date().toISOString();

  let urls: string[];
  if (args.includes("--all")) {
    const existing = loadAllSnapshots(cwd);
    urls = discoverURLs(cwd).filter((url) => {
      const request = resolveAdapter(url);
      return request !== null && !existing.has(request.canonicalURL);
    });
    if (urls.length === 0) {
      console.log("Every bare URL in src/content/ already has a snapshot.");
      return;
    }
    console.log(`Found ${urls.length} un-snapshotted URL(s).`);
  } else {
    urls = args.filter((a) => !a.startsWith("--"));
  }

  if (urls.length === 0) {
    console.error("Usage: npx tsx scripts/embed-snapshot.ts <url> [<url>…] | --all");
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const url of urls) if (!(await snapshot(cwd, url, capturedAt))) failures += 1;

  if (failures > 0) {
    console.error(`\n${failures} of ${urls.length} failed. Un-snapshotted URLs stay plain links.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
```

- [ ] **Step 6: Add the npm convenience script**

In `Resources/Template/package.json`, add to `"scripts"` after `"check"`:

```json
    "embed": "tsx scripts/embed-snapshot.ts",
```

- [ ] **Step 7: Verify the CLI end-to-end against a real post**

This is the one manual step in the plan that uses the network — it is the feature's whole purpose, so it must be exercised once for real. Run from `Resources/Template/`:

```bash
npm run embed -- https://x.com/jack/status/20
```

Expected: `✓ wrote …/src/embeds/<slug>.json`. Then confirm the privacy invariant holds:

```bash
grep -c "https://" src/embeds/*.json
```

Expected: `1` — the only absolute URL in the file is the post's own permalink (`"url"`); the X adapter carries no avatar or media, so there is nothing else to localize.

- [ ] **Step 8: Remove the scratch snapshot**

The template ships no example snapshots — a scaffolded site starts empty.

```bash
rm -rf src/embeds public/embeds
```

- [ ] **Step 9: Commit**

```bash
git add Resources/Template/scripts/ Resources/Template/package.json
git commit -m "feat(#682): embed-snapshot CLI with media download"
```

---

### Task 6: The card renderer

**Files:**
- Create: `Resources/Template/src/lib/embed-card.ts`
- Create: `Resources/Template/src/components/EmbedCard.astro`
- Modify: `Resources/Template/src/styles/global.css` (append)
- Test: `Resources/Template/src/lib/embed-card.test.ts`

**Interfaces:**
- Consumes: `EmbedSnapshot` from `../../scripts/embeds/types`.
- Produces:
  - `function escapeHTML(value: string): string`
  - `interface CardOptions { citeClass?: string; inlineVideo?: boolean }`
  - `function renderEmbedCard(snap: EmbedSnapshot, options?: CardOptions): string`

`citeClass` is the microformats root the reply-context surface needs (`"u-in-reply-to"`, `"u-bookmark-of"`, `"u-like-of"`). Omitted for in-body embeds.

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/src/lib/embed-card.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { EmbedSnapshot } from "../../scripts/embeds/types";
import { escapeHTML, renderEmbedCard } from "./embed-card";

function snap(overrides: Partial<EmbedSnapshot> = {}): EmbedSnapshot {
  return {
    version: 1,
    url: "https://x.com/jack/status/20",
    provider: "x",
    author: { name: "jack", handle: "@jack", url: "https://x.com/jack" },
    content: "just setting up my twttr",
    publishedAt: "2006-03-21T00:00:00.000Z",
    media: [],
    capturedAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

test("escapeHTML: neutralizes every character that could break out of markup", () => {
  assert.equal(escapeHTML(`<script>"x" & 'y'</script>`), "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;");
});

test("renderEmbedCard: hostile post text cannot inject markup", () => {
  const html = renderEmbedCard(snap({ content: '<img src=x onerror="alert(1)">' }));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x"));
});

test("renderEmbedCard: hostile author name and alt text are escaped too", () => {
  const html = renderEmbedCard(
    snap({
      author: { name: '"><script>alert(1)</script>', handle: "@a" },
      media: [{ src: "/embeds/a/asset-0.png", alt: '"><b>' }],
    }),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!/alt="">/.test(html));
});

test("renderEmbedCard: renders author, text, permalink and a machine-readable date", () => {
  const html = renderEmbedCard(snap());
  assert.match(html, /class="embed-card embed-card--x"/);
  assert.match(html, /just setting up my twttr/);
  assert.match(html, /href="https:\/\/x\.com\/jack\/status\/20"/);
  assert.match(html, /<time[^>]+datetime="2006-03-21T00:00:00\.000Z"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("renderEmbedCard: no avatar and no media still produces a valid card", () => {
  const html = renderEmbedCard(snap());
  assert.ok(!html.includes("embed-card__avatar"));
  assert.ok(!html.includes("<img"));
});

test("renderEmbedCard: local media renders; width/height are emitted to prevent layout shift", () => {
  const html = renderEmbedCard(
    snap({ media: [{ src: "/embeds/abc/asset-0.png", alt: "a photo", width: 1200, height: 800 }] }),
  );
  assert.match(html, /<img class="embed-card__media" src="\/embeds\/abc\/asset-0\.png" alt="a photo" width="1200" height="800" loading="lazy" decoding="async">/);
});

test("renderEmbedCard: a remote media src is refused — the privacy invariant is enforced at render", () => {
  const html = renderEmbedCard(snap({ media: [{ src: "https://pbs.twimg.com/x.jpg", alt: "leak" }] }));
  assert.ok(!html.includes("pbs.twimg.com"));
});

test("renderEmbedCard: citeClass wraps the card in h-cite for reply context", () => {
  const html = renderEmbedCard(snap(), { citeClass: "u-in-reply-to" });
  assert.match(html, /class="embed-card embed-card--x u-in-reply-to h-cite"/);
  assert.match(html, /class="embed-card__author p-author h-card"/);
  assert.match(html, /class="embed-card__text p-content"/);
  assert.match(html, /class="embed-card__permalink u-url"/);
  assert.match(html, /class="dt-published"/);
});

test("renderEmbedCard: without citeClass the microformats roots are absent", () => {
  const html = renderEmbedCard(snap());
  assert.ok(!html.includes("h-cite"));
  assert.ok(!html.includes("p-author"));
});

test("renderEmbedCard: youtube renders a thumbnail link, not an iframe, by default", () => {
  const html = renderEmbedCard(
    snap({ provider: "youtube", url: "https://www.youtube.com/watch?v=abc", media: [{ src: "/embeds/a/asset-0.jpg", alt: "T" }] }),
  );
  assert.ok(!html.includes("<iframe"));
  assert.match(html, /embed-card__play/);
});

test("renderEmbedCard: inlineVideo opts into a click-to-load youtube-nocookie iframe", () => {
  const html = renderEmbedCard(
    snap({ provider: "youtube", url: "https://www.youtube.com/watch?v=abc", media: [] }),
    { inlineVideo: true },
  );
  assert.match(html, /<iframe[^>]+src="https:\/\/www\.youtube-nocookie\.com\/embed\/abc"/);
  assert.match(html, /loading="lazy"/);
});

test("renderEmbedCard: inlineVideo on a non-youtube snapshot changes nothing", () => {
  assert.ok(!renderEmbedCard(snap(), { inlineVideo: true }).includes("<iframe"));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test src/lib/embed-card.test.ts
```

Expected: FAIL — `Cannot find module './embed-card'`.

- [ ] **Step 3: Write the renderer**

Create `Resources/Template/src/lib/embed-card.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test src/lib/embed-card.test.ts
```

Expected: PASS, `fail 0`, 12 tests.

- [ ] **Step 5: Add the component wrapper**

Create `Resources/Template/src/components/EmbedCard.astro`:

```astro
---
/**
 * Renders a committed embed snapshot. The markup comes from `renderEmbedCard` as a string so
 * the remark plugin (in-body embeds) and this component (reply context) share exactly one
 * renderer — a plugin cannot instantiate an Astro component. Styles therefore live in
 * global.css under `.embed-card`, not in a scoped block here: Astro's style scoping does not
 * reach markup injected with `set:html`.
 */
import type { EmbedSnapshot } from "../../scripts/embeds/types";
import { renderEmbedCard, type CardOptions } from "../lib/embed-card";

interface Props {
  snapshot: EmbedSnapshot;
  citeClass?: CardOptions["citeClass"];
  inlineVideo?: boolean;
}

const { snapshot, citeClass, inlineVideo } = Astro.props;
const html = renderEmbedCard(snapshot, { citeClass, inlineVideo });
---

<Fragment set:html={html} />
```

- [ ] **Step 6: Add the card styles**

Append to `Resources/Template/src/styles/global.css`:

```css
/* Embed cards (#682). Global rather than scoped: the remark plugin injects this markup as an
   HTML string, which Astro's scoped-style attributes never reach. */
.embed-card {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing-unit) * 2);
  margin-block: calc(var(--spacing-unit) * 6);
  padding: calc(var(--spacing-unit) * 4);
  border: 1px solid var(--color-text-muted);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
}

.embed-card__author {
  display: flex;
  align-items: center;
  gap: calc(var(--spacing-unit) * 2);
  font-weight: 600;
  text-decoration: none;
  color: var(--color-text);
}

.embed-card__avatar {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  object-fit: cover;
}

.embed-card__handle {
  font-weight: 400;
  color: var(--color-text-muted);
}

.embed-card__text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.embed-card__media,
.embed-card__video {
  width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}

.embed-card__video {
  aspect-ratio: 16 / 9;
  border: 0;
}

.embed-card__play {
  font-size: 1.5rem;
  color: var(--color-primary);
}

.embed-card__permalink {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}
```

- [ ] **Step 7: Extend `test:scripts` to cover `src/lib/`**

This is the first test file outside `scripts/`. In `Resources/Template/package.json`, change the `test:scripts` value to:

```json
    "test:scripts": "tsx --test scripts/*.test.ts scripts/embeds/*.test.ts src/lib/*.test.ts",
```

- [ ] **Step 8: Verify the whole suite runs**

```bash
npm run test:scripts
```

Expected: PASS, `fail 0`, with the count risen by the 12 new card tests.

- [ ] **Step 9: Commit**

```bash
git add Resources/Template/src/lib/ Resources/Template/src/components/EmbedCard.astro Resources/Template/src/styles/global.css Resources/Template/package.json
git commit -m "feat(#682): first-party embed card renderer and styles"
```

---

### Task 7: Remark plugin — bare URL becomes a card

**Files:**
- Create: `Resources/Template/scripts/remark-embeds.ts`
- Modify: `Resources/Template/astro.config.ts`
- Test: `Resources/Template/scripts/remark-embeds.test.ts`

**Interfaces:**
- Consumes: `EmbedSnapshot` (Task 2), `loadAllSnapshots` (Task 4), `renderEmbedCard` (Task 6), `readConfig` from `./config`.
- Produces:
  - `interface MdastNode { type: string; value?: string; url?: string; children?: MdastNode[] }`
  - `type SnapshotResolver = (url: string) => EmbedSnapshot | null`
  - `function transformEmbeds(tree: MdastNode, resolve: SnapshotResolver, inlineVideo?: boolean): MdastNode`
  - `default function remarkEmbeds(options?: { cwd?: string })` — the Astro-facing plugin

Mdast node types are declared locally rather than imported: `@types/mdast` is not a dependency and adding one needs issue approval.

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/scripts/remark-embeds.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { EmbedSnapshot } from "./embeds/types";
import { transformEmbeds, type MdastNode } from "./remark-embeds";

const SNAP: EmbedSnapshot = {
  version: 1,
  url: "https://x.com/jack/status/20",
  provider: "x",
  author: { name: "jack" },
  content: "just setting up my twttr",
  media: [],
  capturedAt: "2026-07-25T00:00:00.000Z",
};

const resolve = (url: string) => (url === SNAP.url ? SNAP : null);

function paragraph(...children: MdastNode[]): MdastNode {
  return { type: "paragraph", children };
}
function link(url: string): MdastNode {
  return { type: "link", url, children: [{ type: "text", value: url }] };
}
function root(...children: MdastNode[]): MdastNode {
  return { type: "root", children };
}

test("transformEmbeds: a bare URL alone in a paragraph becomes a card", () => {
  const tree = transformEmbeds(root(paragraph(link(SNAP.url))), resolve);
  assert.equal(tree.children?.[0].type, "html");
  assert.match(tree.children?.[0].value ?? "", /embed-card/);
  assert.match(tree.children?.[0].value ?? "", /just setting up my twttr/);
});

test("transformEmbeds: a URL with surrounding text is left as an ordinary link", () => {
  const tree = transformEmbeds(root(paragraph({ type: "text", value: "see " }, link(SNAP.url))), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: two links in one paragraph are left alone", () => {
  const tree = transformEmbeds(root(paragraph(link(SNAP.url), link(SNAP.url))), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: a URL with no snapshot stays a working link", () => {
  const tree = transformEmbeds(root(paragraph(link("https://example.com/nope"))), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: link text differing from the href is a real link, not an embed", () => {
  const labelled: MdastNode = { type: "link", url: SNAP.url, children: [{ type: "text", value: "this tweet" }] };
  const tree = transformEmbeds(root(paragraph(labelled)), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: a trailing slash still matches the snapshot", () => {
  const tree = transformEmbeds(root(paragraph(link(`${SNAP.url}/`))), resolve);
  assert.equal(tree.children?.[0].type, "html");
});

test("transformEmbeds: other content is untouched and order is preserved", () => {
  const heading: MdastNode = { type: "heading", children: [{ type: "text", value: "Hi" }] };
  const tree = transformEmbeds(root(heading, paragraph(link(SNAP.url)), heading), resolve);
  assert.deepEqual(
    tree.children?.map((n) => n.type),
    ["heading", "html", "heading"],
  );
});

test("transformEmbeds: an empty document is a no-op", () => {
  assert.deepEqual(transformEmbeds(root(), resolve).children, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test scripts/remark-embeds.test.ts
```

Expected: FAIL — `Cannot find module './remark-embeds'`.

- [ ] **Step 3: Write the plugin**

Create `Resources/Template/scripts/remark-embeds.ts`:

```ts
/**
 * Turns a bare URL alone on its own line into a first-party embed card, resolved against the
 * snapshots committed under src/embeds/. Reads the filesystem, never the network — a build can
 * never fail or stall because a platform is down.
 *
 * A URL with no snapshot is left completely alone and renders as an ordinary link, so content
 * stays valid CommonMark and degrades gracefully everywhere else (GitHub, Keystatic, any other
 * renderer). Run `npm run embed -- <url>` to capture one.
 */
import { renderEmbedCard } from "../src/lib/embed-card";
import type { EmbedSnapshot } from "./embeds/types";
import { loadAllSnapshots } from "./embeds/store";
import { readConfig } from "./config";

/** Minimal mdast shape. Declared locally — @types/mdast is not a dependency of this template. */
export interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

export type SnapshotResolver = (url: string) => EmbedSnapshot | null;

/** The href a bare autolink produces: its single text child is the URL itself. */
function bareLinkURL(node: MdastNode): string | null {
  if (node.type !== "paragraph" || node.children?.length !== 1) return null;
  const link = node.children[0];
  if (link.type !== "link" || typeof link.url !== "string") return null;
  if (link.children?.length !== 1) return null;
  const text = link.children[0];
  if (text.type !== "text" || text.value !== link.url) return null;
  return link.url;
}

export function transformEmbeds(
  tree: MdastNode,
  resolve: SnapshotResolver,
  inlineVideo = false,
): MdastNode {
  const children = tree.children ?? [];
  for (let i = 0; i < children.length; i += 1) {
    const url = bareLinkURL(children[i]);
    if (!url) continue;
    const snapshot = resolve(url) ?? resolve(url.replace(/\/+$/, ""));
    if (!snapshot) continue;
    children[i] = { type: "html", value: renderEmbedCard(snapshot, { inlineVideo }) };
  }
  return tree;
}

export default function remarkEmbeds(options: { cwd?: string } = {}) {
  const cwd = options.cwd ?? process.cwd();
  // Loaded once per build, not once per file.
  const snapshots = loadAllSnapshots(cwd);
  const inlineVideo = (readConfig("EMBED_VIDEO_INLINE") ?? "").trim().toLowerCase() === "true";
  const resolve: SnapshotResolver = (url) => snapshots.get(url) ?? null;
  return (tree: MdastNode): void => {
    transformEmbeds(tree, resolve, inlineVideo);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test scripts/remark-embeds.test.ts
```

Expected: PASS, `fail 0`, 8 tests.

- [ ] **Step 5: Register the plugin with Astro**

In `Resources/Template/astro.config.ts`, add the import after the `redirects` import:

```ts
import remarkEmbeds from "./scripts/remark-embeds.ts";
```

Then add a `markdown` key to the `defineConfig` object, after `integrations`:

```ts
  markdown: {
    remarkPlugins: [remarkEmbeds],
  },
```

- [ ] **Step 6: Verify end-to-end through a real build**

Create a scratch snapshot and post, build, then inspect the output:

```bash
mkdir -p src/embeds && cat > src/embeds/aaaaaaaaaaaa.json <<'JSON'
{
  "version": 1,
  "url": "https://x.com/jack/status/20",
  "provider": "x",
  "author": { "name": "jack", "handle": "@jack", "url": "https://x.com/jack" },
  "content": "just setting up my twttr",
  "publishedAt": "2006-03-21T00:00:00.000Z",
  "media": [],
  "capturedAt": "2026-07-25T00:00:00.000Z"
}
JSON
cat > src/content/blog/embed-smoke.md <<'MD'
---
title: Embed smoke
pubDate: 2026-07-25
---

Before.

https://x.com/jack/status/20

After.
MD
npm run build && grep -c "embed-card" dist/blog/embed-smoke/index.html
```

Expected: the build succeeds and `grep` prints `1` or more.

- [ ] **Step 7: Remove the scratch files**

```bash
rm -rf src/embeds src/content/blog/embed-smoke.md
```

- [ ] **Step 8: Commit**

```bash
git add Resources/Template/scripts/remark-embeds.ts Resources/Template/scripts/remark-embeds.test.ts Resources/Template/astro.config.ts
git commit -m "feat(#682): remark plugin renders bare URLs as embed cards"
```

---

### Task 8: IndieWeb reply context

**Files:**
- Modify: `Resources/Template/src/layouts/Hentry.astro:58-60`
- Test: `Resources/Template/src/lib/embed-card.test.ts` (append)

**Interfaces:**
- Consumes: `loadAllSnapshots` (Task 4), `renderEmbedCard` / `EmbedCard.astro` (Task 6).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `Resources/Template/src/lib/embed-card.test.ts`:

```ts
test("reply context: each citation class produces the matching mf2 root", () => {
  for (const citeClass of ["u-in-reply-to", "u-bookmark-of", "u-like-of"]) {
    const html = renderEmbedCard(snap(), { citeClass });
    assert.ok(html.includes(`${citeClass} h-cite`), citeClass);
    assert.ok(html.includes("p-author h-card"), citeClass);
    assert.ok(html.includes("u-url"), citeClass);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test src/lib/embed-card.test.ts
```

Expected: PASS already — `renderEmbedCard` from Task 6 handles this. This step confirms the contract before wiring the layout; if it fails, Task 6 is incomplete and must be fixed first.

- [ ] **Step 3: Wire the layout**

In `Resources/Template/src/layouts/Hentry.astro`, add to the imports (after the `DraftBadge` import):

```ts
import EmbedCard from "../components/EmbedCard.astro";
import { loadAllSnapshots } from "../../scripts/embeds/store";
import { readConfig } from "../../scripts/config.ts";
```

Add to the frontmatter, after the `jsonLd` assignment:

```ts
// Reply context (#682). Snapshots are read from src/embeds/ — committed, never fetched. With no
// snapshot for a cited URL these fall through to the bare links this layout has always rendered.
const snapshots = loadAllSnapshots(process.cwd());
const inlineVideo = (readConfig("EMBED_VIDEO_INLINE") ?? "").trim().toLowerCase() === "true";
const cited = (url: string | undefined) => (url ? (snapshots.get(url) ?? null) : null);
const bookmarkCite = cited(d.bookmarkOf);
const replyCite = cited(d.inReplyTo);
const likeCite = cited(d.likeOf);
```

Replace lines 58-60 (the three bare-link expressions) with:

```astro
    {d.bookmarkOf && (bookmarkCite
      ? <EmbedCard snapshot={bookmarkCite} citeClass="u-bookmark-of" inlineVideo={inlineVideo} />
      : <a class="u-bookmark-of" href={d.bookmarkOf}>{d.bookmarkOf}</a>)}
    {d.inReplyTo && (replyCite
      ? <EmbedCard snapshot={replyCite} citeClass="u-in-reply-to" inlineVideo={inlineVideo} />
      : <a class="u-in-reply-to" href={d.inReplyTo}>In reply to</a>)}
    {d.likeOf && (likeCite
      ? <EmbedCard snapshot={likeCite} citeClass="u-like-of" inlineVideo={inlineVideo} />
      : <a class="u-like-of" href={d.likeOf}>Liked this</a>)}
```

- [ ] **Step 4: Verify both branches through a real build**

```bash
npm run build && npx tsx --test scripts/microformats.test.ts
```

Expected: the build succeeds (exercising the no-snapshot fallback for the template's existing content) and the microformats suite passes.

Now check the snapshot branch:

```bash
mkdir -p src/embeds && cat > src/embeds/bbbbbbbbbbbb.json <<'JSON'
{
  "version": 1,
  "url": "https://indieweb.org/reply",
  "provider": "opengraph",
  "author": { "name": "indieweb.org" },
  "content": "A post worth replying to",
  "media": [],
  "capturedAt": "2026-07-25T00:00:00.000Z"
}
JSON
cat > src/content/replies/cite-smoke.md <<'MD'
---
inReplyTo: https://indieweb.org/reply
publishDate: 2026-07-25
---

My reply.
MD
npm run build && grep -o "u-in-reply-to h-cite" dist/replies/cite-smoke/index.html
```

Expected: prints `u-in-reply-to h-cite`.

- [ ] **Step 5: Remove the scratch files**

```bash
rm -rf src/embeds src/content/replies/cite-smoke.md
```

- [ ] **Step 6: Run the Swift suites**

Template markup changes can break Swift string-match tests. Run from the **repo root**:

```bash
swift test --package-path .
```

Expected: PASS. If a Swift test asserts on the old bare-link markup, update that assertion — the fallback branch preserves it, so a failure here means a test was matching something else.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/src/layouts/Hentry.astro Resources/Template/src/lib/embed-card.test.ts
git commit -m "feat(#682): render IndieWeb reply context as h-cite embed cards"
```

---

### Task 9: CSP opt-in and the pre-deploy privacy gate

**Files:**
- Modify: `Resources/Template/scripts/csp.ts`
- Modify: `Resources/Template/scripts/csp.test.ts` (append)
- Modify: `Resources/Template/scripts/pre-deploy-check.ts`
- Modify: `Resources/Template/scripts/pre-deploy-check.test.ts` (append)

**Interfaces:**
- Consumes: `readConfigFromString` from `./config`.
- Produces: `function checkEmbedMedia(content: string, file: string): Issue[]` exported from `pre-deploy-check.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `Resources/Template/scripts/csp.test.ts`:

```ts
test("buildCSP: EMBED_VIDEO_INLINE=true allows youtube-nocookie in frame-src only", () => {
  const csp = buildCSP("EMBED_VIDEO_INLINE=true");
  assert.match(csp, /frame-src 'self' www\.youtube-nocookie\.com;/);
  assert.ok(!/script-src[^;]*youtube/.test(csp));
  assert.ok(!/img-src[^;]*youtube/.test(csp));
  assert.ok(!/connect-src[^;]*youtube/.test(csp));
});

test("buildCSP: EMBED_VIDEO_INLINE defaults off, and only exact 'true' enables it", () => {
  for (const cfg of ["", "EMBED_VIDEO_INLINE=false", "EMBED_VIDEO_INLINE=1", "EMBED_VIDEO_INLINE=yes"]) {
    assert.match(buildCSP(cfg), /frame-src 'self';/, cfg);
  }
});
```

Append to `Resources/Template/scripts/pre-deploy-check.test.ts` (add `checkEmbedMedia` to that file's existing import from `./pre-deploy-check`):

```ts
test("checkEmbedMedia: a hotlinked platform image is an error", () => {
  const issues = checkEmbedMedia('<img src="https://pbs.twimg.com/media/x.jpg">', "dist/index.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].category, "embed-media-hotlink");
});

test("checkEmbedMedia: every known platform media host is caught", () => {
  for (const host of [
    "pbs.twimg.com",
    "scontent.cdninstagram.com",
    "cdn.bsky.app",
    "files.mastodon.social",
    "i.ytimg.com",
  ]) {
    assert.equal(checkEmbedMedia(`<img src="https://${host}/a.jpg">`, "f.html").length, 1, host);
  }
});

test("checkEmbedMedia: self-hosted embed media passes", () => {
  assert.deepEqual(checkEmbedMedia('<img src="/embeds/abc123/asset-0.png">', "dist/index.html"), []);
});

test("checkEmbedMedia: srcset and CSS url() are caught too", () => {
  assert.equal(checkEmbedMedia('<img srcset="https://pbs.twimg.com/a.jpg 2x">', "f.html").length, 1);
  assert.equal(checkEmbedMedia("a{background:url(https://cdn.bsky.app/x.png)}", "f.css").length, 1);
});

test("checkEmbedMedia: a permalink to the platform is not media and must pass", () => {
  assert.deepEqual(checkEmbedMedia('<a href="https://x.com/jack/status/20">View original</a>', "f.html"), []);
});

test("checkEmbedMedia: the youtube-nocookie iframe is not a media hotlink", () => {
  assert.deepEqual(checkEmbedMedia('<iframe src="https://www.youtube-nocookie.com/embed/a"></iframe>', "f.html"), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test scripts/csp.test.ts scripts/pre-deploy-check.test.ts
```

Expected: FAIL — `frame-src 'self';` where `www.youtube-nocookie.com` was expected, and `checkEmbedMedia is not a function`.

- [ ] **Step 3: Add the CSP opt-in**

In `Resources/Template/scripts/csp.ts`, inside `buildCSP`, insert after the `for (const name of EMBED_DIRECTIVES)` loop and before the `return`:

```ts
  // Inline video (#682) is opt-in and narrow: click-to-load youtube-nocookie only, and only
  // frame-src. The default card is a thumbnail link, so the baseline policy stays untouched.
  // Exact "true" only — matching HSTS_PRELOAD's deliberate strictness above.
  if ((readConfigFromString(configContent, "EMBED_VIDEO_INLINE") ?? "").trim().toLowerCase() === "true") {
    directives["frame-src"].push("www.youtube-nocookie.com");
  }
```

- [ ] **Step 4: Add the pre-deploy rule**

In `Resources/Template/scripts/pre-deploy-check.ts`, add after the `BLOCKED_ROUTES` declaration:

```ts
/**
 * Media hosts belonging to the platforms the embed snapshotter supports (#682). A reference to
 * one of these in built output means an embed is hotlinking rather than serving its snapshotted
 * copy, which leaks every visitor's IP and Referer to the platform — the tracking ADR-0008
 * exists to prevent. Anchor hrefs are excluded: a permalink back to the original post is the
 * point of a citation.
 */
const EMBED_MEDIA_HOSTS = [
  "pbs.twimg.com",
  "video.twimg.com",
  "abs.twimg.com",
  "scontent.cdninstagram.com",
  "cdninstagram.com",
  "cdn.bsky.app",
  "i.ytimg.com",
  "img.youtube.com",
  /** Mastodon media is per-instance; files.* covers the common CDN shape. */
  "files.mastodon.social",
];
```

And add this exported function next to the other `check*` functions:

```ts
/**
 * Hotlinked platform media in built output. Matches resource-loading contexts only —
 * `src`, `srcset`, and CSS `url(...)` — never `href`, so citation permalinks pass.
 * One issue per offending host per file.
 */
export function checkEmbedMedia(content: string, file: string): Issue[] {
  const issues: Issue[] = [];
  for (const host of EMBED_MEDIA_HOSTS) {
    const escaped = host.replace(/\./g, "\\.");
    const pattern = new RegExp(
      `(?:\\bsrc\\s*=\\s*["']|\\bsrcset\\s*=\\s*["'][^"']*?|url\\(\\s*["']?)(?:https?:)?//[^"')\\s]*${escaped}`,
      "i",
    );
    if (pattern.test(content)) {
      issues.push({
        severity: "error",
        category: "embed-media-hotlink",
        message: `Embed media hotlinked from ${host} — run "npm run embed -- <url>" to snapshot it first-party.`,
        file,
      });
    }
  }
  return issues;
}
```

Finally, call it from `scan()`. In the `for await (const file of walk(DIST_DIR))` loop, add immediately after the `checkPII` call:

```ts
    if (/\.(html?|css)$/i.test(file)) {
      issues.push(...checkEmbedMedia(content, rel));
    }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx tsx --test scripts/csp.test.ts scripts/pre-deploy-check.test.ts
```

Expected: PASS, `fail 0`.

- [ ] **Step 6: Verify the committed `_headers` fixture still matches**

`csp.test.ts` asserts that the committed `public/_headers` is byte-identical to `buildHeaders("")`. The default path is unchanged, so this must still hold:

```bash
npx tsx scripts/csp.ts && git diff --exit-code public/_headers
```

Expected: no diff, exit 0.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/scripts/csp.ts Resources/Template/scripts/csp.test.ts Resources/Template/scripts/pre-deploy-check.ts Resources/Template/scripts/pre-deploy-check.test.ts
git commit -m "feat(#682): gate hotlinked embed media, add inline-video CSP opt-in"
```

---

### Task 10: Owner documentation and full verification

**Files:**
- Create: `Resources/Template/integrations/docs/embeds-setup.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Write the owner doc**

Create `Resources/Template/integrations/docs/embeds-setup.md`:

````markdown
# Embedding social posts

Anglesite embeds posts from X, Bluesky, Mastodon, YouTube — and any other URL — without
loading a single line of the platform's JavaScript and without your visitors' browsers ever
talking to the platform. It does this by **snapshotting** the post into your own site repo.

## Adding an embed

1. Snapshot the post:

   ```sh
   npm run embed -- https://x.com/jack/status/20
   ```

2. Put the URL on a line by itself in your Markdown:

   ```markdown
   Here's where it all started.

   https://x.com/jack/status/20

   Twenty years later…
   ```

3. Commit `src/embeds/` and `public/embeds/` along with your post.

That's it. The URL renders as a card; everything it displays is served from your own domain.

To sweep a site you've already written, snapshot every bare URL at once:

```sh
npm run embed -- --all
```

## Reply, bookmark, and like context

Set `inReplyTo`, `bookmarkOf`, or `likeOf` in a post's frontmatter and snapshot that URL — the
cited post renders as a card with correct `h-cite` microformats, which is what other IndieWeb
sites read when they receive your Webmention.

## What happens if you skip the snapshot

Nothing breaks. An un-snapshotted URL stays an ordinary link. Builds never contact the network,
so a platform being down, rate-limiting you, or deleting the post can never fail your build.

## Why snapshots instead of live embeds

- **No tracking.** A normal embed lets the platform see every visitor to your page. A snapshot
  is just HTML and images from your own domain.
- **It outlives the platform.** The post is in your git repo. If the account is deleted, the
  post is removed, or the platform shuts off its API, your page keeps rendering.
- **Fast pages.** No third-party scripts, no render-blocking requests.

The trade-off: a snapshot is a point-in-time capture. If the original post is later edited,
your copy still shows what it said when you captured it. Re-run the same command to refresh it.

## Instagram

Instagram requires a Meta app token for its API and blocks automated page requests, so it can't
be snapshotted automatically. Snapshot the URL anyway to get a link card, then save a screenshot
into `public/embeds/<slug>/` and add it to that snapshot's `media` array.

## Playing videos inline (optional)

By default a YouTube URL renders as a thumbnail linking to the video — no third-party requests.
To play videos in the page instead, add to `.site-config`:

```
EMBED_VIDEO_INLINE=true
```

This uses `youtube-nocookie.com` and loads the player only when the visitor scrolls to it. It
is the one setting here that permits any third-party connection, which is why it's off by
default and why `frame-src` widens to exactly that one host and nothing else.
````

- [ ] **Step 2: Run every test suite**

From `Resources/Template/`:

```bash
npm run test:scripts && npm run test:worker && npm run build
```

Expected: all PASS, `fail 0`, build succeeds.

- [ ] **Step 3: Run the pre-deploy gate against the built output**

```bash
npm run check
```

Expected: exit 0, no `embed-media-hotlink` findings (the template ships no snapshots).

- [ ] **Step 4: Run the Swift suites from the repo root**

```bash
swift test --package-path .
```

Expected: PASS.

- [ ] **Step 5: Confirm no dependency was added**

```bash
git diff main -- Resources/Template/package.json | grep -E '^\+.*"[^"]+": "\^?[0-9]'
```

Expected: no output — the only dependency-line change in this branch is the **removal** of `astro-embed`.

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/integrations/docs/embeds-setup.md
git commit -m "docs(#682): owner guide for privacy-preserving embeds"
```

---

## Post-implementation

Before opening the PR, re-read `CONTRIBUTING.md` ▸ "Commits and pull requests" and build the PR
body from `.github/PULL_REQUEST_TEMPLATE.md`'s actual headings — **Summary**, **Paired PR
check**, **Test plan**. Under Paired PR check, state that this is app-repo-only: no MCP schema
change, so no sidecar PR is required. Note the two follow-ups the spec defers (§9): the app's
"Add Embed…" affordance, and the sibling-repo `Anglesite/anglesite` docs PR amending ADR-0008
and recording the Zaraz rejection.

Remove the `🛠️ In Progress` label from #682 once the PR is open.
