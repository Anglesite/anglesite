# Privacy-preserving embeds for legacy social content

**Date:** 2026-07-25
**Status:** Design (no implementation yet)
**Issue:** [#682](https://github.com/Anglesite/Anglesite-app/issues/682)
**Constraint:** [ADR-0008 — No third-party JavaScript in production](https://github.com/Anglesite/anglesite/blob/main/docs/decisions/0008-no-third-party-javascript.md) (sibling repo)

---

## 1. Scope

Owners want to embed content from legacy social platforms — a tweet quoted in a blog
post, the post a reply is replying to. Today the template has no embed story at all:
`bookmarkOf` / `inReplyTo` / `likeOf` render as bare `<a>` links in
`src/layouts/Hentry.astro`, and the `astro-embed` dependency declared in
`Resources/Template/package.json` is used nowhere.

This spec settles the evaluation #682 asks for (Cloudflare Zaraz SSR vs build-time
oEmbed snapshotting) and specifies the chosen direction: **snapshot the remote post
once, at author time, into the site's own git repo, and render it as a first-party
card at build time.**

**In scope:** the snapshot store and CLI, platform adapters for X / Bluesky /
Mastodon / YouTube plus a generic Open Graph fallback, a remark plugin that turns a
bare URL into a card, a single `EmbedCard.astro` renderer used by both surfaces
(post bodies and IndieWeb reply context), the CSP opt-in for inline video, a
pre-deploy scan rule that enforces the privacy property, tests, and owner docs.

**Out of scope (tracked as follow-ups, §9):** the Mac app's "Add Embed…" affordance;
Instagram / Vimeo / Gist adapters; the sibling-repo ADR amendment.

## 2. The evaluation (#682's actual question)

| | Zaraz SSR embeds | **Build-time snapshot** | astro-embed as-shipped |
|---|---|---|---|
| Third-party JS on page | None | None | None for X/Bluesky/Mastodon; facade for video |
| Third-party **image** requests | Proxied via your domain | Self-hosted | Hotlinked |
| Platform coverage | X + Instagram only | Any URL (OG) + 4 adapters | X, Bluesky, Mastodon, YT, Vimeo, Gist |
| Works in `astro dev` / `preview` | **No** | Yes | Yes |
| Works off Cloudflare | **No** | Yes | Yes |
| Configuration lives in | CF dashboard, per-zone | The site's git repo | Code |
| Survives platform deleting the post | No | **Yes** | No |
| Survives platform killing its oEmbed API | No | **Yes** | No |
| Build determinism | n/a | Hermetic | Network-dependent |

**Chosen: build-time snapshot.**

Zaraz SSR genuinely does solve the third-party-JavaScript problem — Cloudflare
renders the embed at the edge and strips the platform's scripts. But it solves it *at
request time, at the edge*, so the rendered artifact exists nowhere the owner can
see, keep, or move. It is invisible in local preview, it evaporates if the site
leaves Cloudflare, and it is configured in a dashboard rather than in the repo. That
collides with two load-bearing project commitments: **git is the source of truth**
(`AGENTS.md` ▸ Editing guidelines) and **owner controls everything** (ADR-0011). It
is also X + Instagram only.

The decisive argument is #682's own framing. This is *legacy* social content — the
premise is that these platforms are decaying. A design that re-fetches from X on
every build has bet the owner's archive on X's continued goodwill. A committed
snapshot means that the day `publish.x.com` goes away, every already-published post
keeps rendering, forever, from files in the owner's own repo.

Zaraz is recorded as a rejected alternative, not a fallback.

### 2.1 Endpoint reality check (probed 2026-07-25)

| Endpoint | Status | Yields |
|---|---|---|
| `publish.twitter.com/oembed` | 200 (301 → `publish.x.com`), unauthenticated | Post text, author name/handle, date. **No avatar, no media.** |
| `public.api.bsky.app` (AT Proto) | Public, unauthenticated | Full post incl. author, avatar, embedded media |
| Mastodon instance API | Public, unauthenticated | Full post incl. author, avatar, media |
| `youtube.com/oembed` | 200, unauthenticated | Title, author, thumbnail |
| `graph.facebook.com/…/instagram_oembed` | 200 but returns a JS-dependent blockquote; withholds `thumbnail_url` without a Meta app token | Not usable without credentials |

Instagram is therefore excluded from the first slice and degrades to the generic OG
path plus a manual-screenshot escape hatch (§6).

## 3. Decisions settled during brainstorming

| Decision | Choice |
|---|---|
| Direction | Build-time snapshot committed to git; Zaraz rejected (§2). |
| Surfaces | Both post bodies and IndieWeb reply/bookmark/like context, sharing one renderer. |
| Fetch policy | Fetch once at author time, commit the result. Builds never touch the network. |
| Media | Downloaded into the site repo and served first-party. Hotlinking is rejected — it leaks every visitor's IP and `Referer` to the platform, which is the exact tracking ADR-0008 exists to prevent. |
| Platform coverage (slice 1) | Generic OG + X + Bluesky + Mastodon + YouTube. |
| Authoring syntax | A bare URL alone on its own line. Content stays pure CommonMark. |
| Video | A link with a self-hosted thumbnail by default; inline iframe is an explicit opt-in. |
| `astro-embed` dependency | Removed — unused, and its build-time fetching contradicts the chosen fetch policy. |

## 4. Architecture

```
author time (once, explicit)          build time (hermetic)         request time
─────────────────────────────         ─────────────────────         ────────────
npx tsx scripts/embed-snapshot.ts     remark-embeds plugin          static HTML
  <url>                                 reads src/embeds/*.json     first-party imgs
    ↓ network (only here)                 ↓                         zero 3P requests
  src/embeds/<slug>.json  ─────────►  EmbedCard markup
  public/embeds/<slug>/*              (or leaves the link alone)
```

### 4.1 Modules

Each has one job, and everything that can be pure is pure.

| Module | Job | Pure? |
|---|---|---|
| `scripts/embeds/adapters.ts` | URL → `{provider, canonicalURL, apiRequest}` | ✅ |
| `scripts/embeds/fetch.ts` | The **only** module that touches the network | ❌ |
| `scripts/embeds/normalize.ts` | Raw payload → `EmbedSnapshot` | ✅ |
| `scripts/embeds/store.ts` | Read/write `src/embeds/`, media paths, slug derivation | ❌ (fs) |
| `scripts/embed-snapshot.ts` | CLI entry point | ❌ |
| `scripts/remark-embeds.ts` | mdast transform; takes a resolver function as a parameter | ✅ |
| `src/lib/embed-card.ts` | `EmbedSnapshot` → card props + microformats classes | ✅ |
| `src/components/EmbedCard.astro` | The one renderer, used by both surfaces | ✅ |

This split keeps the network in exactly one file, which is what makes the rest
unit-testable without fixtures-over-HTTP or a mock server.

### 4.2 The `EmbedSnapshot` shape

Every adapter converges on one normalized record; the card only ever sees this.
Adding a platform later means writing one adapter file and changing nothing else.

```ts
interface EmbedSnapshot {
  version: 1;
  url: string;              // canonical permalink
  provider: "x" | "bluesky" | "mastodon" | "youtube" | "opengraph";
  author: { name: string; handle?: string; url?: string; avatar?: string };
  content: string;          // plain text; never trusted as HTML
  publishedAt?: string;     // ISO 8601
  media: Array<{ src: string; alt: string; width?: number; height?: number }>;
  capturedAt: string;       // ISO 8601
}
```

`author.avatar` and `media[].src` are repo-relative paths under `/embeds/<slug>/`,
never remote URLs. `content` is stored as plain text and escaped at render time —
platform post text is untrusted input.

### 4.3 Slug derivation

`<slug>` is the first 12 hex characters of the SHA-256 of the canonical URL. Stability matters: re-running
the CLI on the same URL must overwrite the same files rather than accumulate
duplicates, and the slug appears in committed media paths that end up in built HTML.

### 4.4 Authoring syntax

The remark plugin matches a paragraph whose **only** child is a link, looks up a
snapshot by canonical URL, and replaces the paragraph with the card. A paragraph with
a link plus surrounding text, or with several links, is left alone.

Content stays pure CommonMark, so it renders correctly on GitHub, in Keystatic's
editor, in any other SSG, and in a plain text editor. This is the same convention
WordPress and the IndieWeb converged on, and it is why no MDX migration and no custom
directive syntax are needed.

### 4.5 Reply context

`src/layouts/Hentry.astro` currently renders three bare links. Each becomes an
`EmbedCard` when a snapshot exists, wrapped in the microformats2 markup that
receiving Webmention endpoints actually parse:

```html
<div class="u-in-reply-to h-cite">
  <a class="p-author h-card" href="…">…</a>
  <p class="p-content">…</p>
  <a class="u-url" href="…"><time class="dt-published" datetime="…">…</time></a>
</div>
```

With no snapshot, it falls back to exactly today's bare link — so this is additive
and cannot regress existing sites.

## 5. Privacy enforcement

**The CSP baseline does not change.** Every byte a default card renders is first-party, so
`script-src 'self'`, `frame-src 'self'`, and `img-src 'self' data:` in
`scripts/csp.ts` all stay as they are. A correct implementation needs **no allowlist
entry and no new ADR-0008 exception** — that is the test of whether the design is
actually privacy-preserving rather than privacy-flavored. Hotlinking, by contrast,
would require `img-src pbs.twimg.com scontent.cdninstagram.com …`, growing the very
exception list this project is trying to keep short.

**A new pre-deploy scan rule makes the property mechanical rather than aspirational.**
`scripts/pre-deploy-check.ts` gains an `embed-media` check: scan `dist/` for
`src` / `srcset` / `href` attributes pointing at known platform media hosts and fail
the deploy if any survive. Per ADR-0007 the owner cannot override it. Without this,
the privacy guarantee silently regresses the first time someone hand-writes an
`<img>` against a platform CDN.

**Video is a link, not an iframe, by default.** A YouTube URL snapshots to title,
author, and a self-hosted thumbnail, rendered as a link to the video with a play
affordance — which is already what ADR-0008's alternatives table prescribes, and it
keeps `frame-src 'self'`. Owners who want inline playback set
`EMBED_VIDEO_INLINE=true` in `.site-config`; the card becomes a `loading="lazy"`
`youtube-nocookie.com` iframe and `csp.ts` adds that single host to `frame-src`
through the existing config-driven path. That is scroll-triggered, not
click-to-load: the player is requested once it approaches the viewport, with no
action from the visitor, and not at all on a page they never scroll that far down.
A true click-to-load facade is deliberately out of scope — it would require
first-party JavaScript delivered as a file (`script-src 'self'` permits no inline
handler, and the card markup is injected as raw HTML the bundler never scans), which
is disproportionate for an opt-in path and cuts against the feature's no-JS thesis.
What makes the trade acceptable is the rest of it: off by default, opt-in through a
recorded and reversible `.site-config` edit, `youtube-nocookie.com` rather than
`youtube.com`, and exactly one host added to `frame-src`.

## 6. Failure behavior

In preference order:

1. Platform adapter succeeds → full card.
2. Adapter fails, or the platform is unsupported → generic Open Graph scrape → link card.
3. OG fetch also fails (Instagram's bot-blocking is the realistic case) → **write no
   snapshot, exit non-zero, and explain why**, pointing at the manual escape hatch:
   drop a screenshot into `public/embeds/<slug>/` and reference it from the snapshot
   JSON's `media[]`. This is ADR-0008's existing "static screenshots with links"
   advice, now with a structured place to put the screenshot.
4. **A build can never break because a remote is down** — there is no remote in the
   build. A missing snapshot degrades to a plain, working link.

The CLI streams its progress and failures to stdout/stderr so the app's debug pane
shows them verbatim when the affordance lands (`AGENTS.md` ▸ "Logs are sacred").

## 7. Testing

Template convention: `npx tsx --test` with `node:test`; vitest stays worker-only.

| Unit | Test |
|---|---|
| `adapters.ts` | URL → provider resolution, incl. `x.com` / `twitter.com` equivalence, `youtu.be` short form, unknown host → OG fallback |
| `normalize.ts` | Each platform's recorded payload → `EmbedSnapshot`; malformed and partial payloads degrade rather than throw |
| `remark-embeds.ts` | Bare-URL paragraph → card; URL with surrounding text → untouched; missing snapshot → untouched; multiple links in one paragraph → untouched |
| `embed-card.ts` | Correct microformats classes per surface; HTML escaping of hostile post text |
| `store.ts` | Slug stability across runs; re-snapshot overwrites rather than duplicates |
| `csp.ts` | `EMBED_VIDEO_INLINE` adds `youtube-nocookie.com` to `frame-src` and nothing else |
| `pre-deploy-check.ts` | Hotlinked platform media in `dist/` is an **error**; self-hosted `/embeds/…` passes |

Fixtures are recorded JSON committed to the repo — **no test touches the network**,
matching the hermetic-build principle the design rests on.

Because template markup changes can break Swift string-match tests,
`swift test --package-path .` runs before the PR alongside the template's own
`npm run build` and `npx tsx --test`.

## 8. Costs, stated plainly

- **Repo growth.** Committed media grows the site repo. Mitigated by one directory
  per snapshot and a cap on fetched image dimensions.
- **Point-in-time capture.** A snapshot will not reflect a later-edited upstream
  post. Arguably correct for a citation, but it is a real behavior change from live
  embeds and should be documented for owners.
- **Snapshotting is a manual step.** Pasting a URL leaves a plain link until the CLI
  runs. This is deliberate — an implicit auto-fetch would put the network back in the
  build path and re-acquire every problem this design removes — but it means the app
  affordance (§9) matters more than its "follow-up" status suggests.
- **Per-platform maintenance.** Each adapter is a small ongoing liability as
  platforms change their APIs. The generic OG fallback bounds the blast radius: an
  adapter breaking degrades that platform to a link card, never to a build failure.

## 9. Follow-ups

- **App affordance** — an "Add Embed…" command that runs the CLI through
  `SiteRuntime` and streams output to the debug pane. Deliberately excluded to keep
  this a clean template-only PR; the CLI is the source of truth and works without it.
- **Instagram / Vimeo / Gist adapters** — Instagram drags Meta app-token
  provisioning into scope and needs its own design.
- **Sibling-repo docs PR** against `Anglesite/anglesite`: amend ADR-0008's
  alternatives table (the social-embeds and YouTube rows now point at snapshotted
  first-party cards) and add an ADR recording the Zaraz-SSR rejection with §2's
  reasoning. Cross-repo, so it cannot ride in this PR; noted in the PR body.

This is an app-repo-only change. No MCP schema change, so **no paired sidecar PR** is
required.
