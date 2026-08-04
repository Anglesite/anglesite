# AT Protocol Standard.site publishing — design exploration

## Problem / motivation

[Standard.site](https://standard.site/) is a community Lexicon suite for long-form publishing
on the AT Protocol, created by Leaflet, pckt.blog, and Offprint and since adopted by a growing
tool ecosystem (WordPress plugin, EmDash CMS, the Sequoia CLI, an `astro-standard-site`
integration). The AT Protocol blog calls it one of the most successful community-generated
Lexicons on the Atmosphere ([Standard Site and the Bluesky timeline](https://atproto.com/blog/standard-site-bluesky-timeline),
[Build an Atmospheric Website](https://atproto.com/blog/atmospheric-website)).

For an Anglesite site it buys three things, all squarely inside the Personal Publishing OS
pivot's "own your social web" thesis (#334):

1. **Rich previews on Bluesky.** Links to pages backed by a `site.standard.document` record get
   enhanced preview cards in Bluesky apps — better distribution for the same POSSE post the app
   already sends.
2. **Atmosphere discoverability.** Independent indexers (docs.surf, pckt search, etc.) surface
   standard.site records; the site joins a network without ceding canonical ownership.
3. **Content portability.** The owner's writing exists as records in *their* PDS repo — the same
   own-your-data story as the site's `Source/` git repo, extended to the Atmosphere.

## Key architectural finding: this is not a deploy target

Standard.site does **not** host the website. The site stays wherever it is deployed (Cloudflare
Workers, for us); standard.site adds *metadata records in the owner's atproto PDS* plus
bidirectional verification between the domain and those records. Concretely:

- `site.standard.publication` — one record describing the site (name, `url`, description, icon).
- `site.standard.document` — one record per post/article. Required: `site` (the publication
  at-URI), `title`, `publishedAt`. Optional: `path` (joined with the publication `url` to form
  the canonical URL), `description`, `tags`, `textContent` (plaintext body), `content` (open
  union — format deliberately left to platforms), `coverImage` (blob ≤1 MB), `updatedAt`,
  `bskyPostRef`, `contributors`, `labels`
  ([document lexicon](https://standard.site/docs/lexicons/document)).
- Verification: the domain serves `/.well-known/site.standard.publication` returning the
  publication at-URI, and each page's HTML carries
  `<link rel="site.standard.document" href="at://…">`. The two ends point at each other; no
  central registry.

So the right home in this app is the **post-deploy syndication family** (webmentions → POSSE →
WebSub → ActivityPub backfill,
[DeployCoordinator.runPostDeploySequencing](../../../Sources/AnglesiteCore/DeployCoordinator.swift)),
**not** a new deploy provider. The v1 "Cloudflare Workers only, no `DeployTarget` abstraction"
decision (`docs/specs/2026-06-26-personal-publishing-os-pivot-analysis.md` §5.5) stands
untouched. This also keeps a clean answer to §5.5's pure-static tension: dynamic endpoints
(webmention inbox, Micropub, ActivityPub) remain Worker-only; standard.site needs none of them.

## Prior art already in-repo

Most of the plumbing exists:

| Need | Existing code |
|---|---|
| atproto session + record writes | [BlueskyPOSSEClient](../../../Sources/AnglesiteCore/POSSEClients.swift) — `com.atproto.server.createSession`, `com.atproto.repo.createRecord`, deterministic `rkey` + 409-dedupe |
| Site-scoped atproto credential | `SecretStore.blueskyAppPassword(siteID:)` + `POSSECredentials.Bluesky` (PDS URL, identifier, app password) |
| Idempotency keys | [POSSEStableKey](../../../Sources/AnglesiteCore/POSSEClients.swift) FNV-1a — proven in production for Bluesky rkeys |
| Post-deploy pass shape (ledger in `Config/`, best-effort, debug-pane logging) | [POSSESyndicationCommand](../../../Sources/AnglesiteCore/POSSESyndicationCommand.swift) |
| `/.well-known/` ownership | Well-known claims machinery (`WellKnownInventory`, template `well-known.ts`; spec `2026-07-14-well-known-support-design.md`) |
| Bluesky identity awareness | `_atproto` TXT domain verification ([DomainModel](../../../Sources/AnglesiteApp/DomainModel.swift)), `at://` handling in `Resources/Template/scripts/embeds/` |

The gap is genuinely narrow: two new record shapes, one new post-deploy pass, one well-known
file, and per-page `<link>` tags.

## Design

### 1. Credential: reuse the POSSE Bluesky account

The pass activates when the site already has a Bluesky POSSE credential configured — the same
identifier/app password/PDS URL. **Zero new onboarding.** No credential → the pass no-ops,
matching how the POSSE pass skips unconfigured platforms. Per #1004, any UI copy says
"Atmosphere", not "ATProtocol".

### 2. Deterministic rkeys → stateless idempotent publishing

Sequoia and the Astro integration track record at-URIs in state files (`.sequoia-state.json`)
because they mint random/TID rkeys. We instead derive rkeys the way `BlueskyPOSSEClient`
already does:

- publication rkey: `anglesite-<fnv1a(siteUUID)>`
- document rkey: `anglesite-<fnv1a(siteUUID + path)>`

and write with `com.atproto.repo.putRecord` (create-or-update semantics) instead of
`createRecord`. Consequences:

- **No state file.** Re-publishing after any crash, clone, or ledger loss converges on the same
  records. The at-URI of every record is computable offline from `.site-config` + the DID.
- **Build-time verifiable links.** Because rkeys are deterministic and the DID is known after
  first credential use (persist `ATPROTO_DID` into `.site-config`, template-owned like
  `SITE_URL`), the Astro build can emit `/.well-known/site.standard.publication` and per-page
  `<link rel="site.standard.document">` tags with **no network calls and no publish-before-build
  ordering problem**. This is the main reason not to adopt `astro-standard-site` wholesale.
- Updates are free: content edits simply overwrite the record; `updatedAt` is set when the
  source file's modification is newer than `publishedAt`.

### 3. Record content

v1 maps what the content graph already knows
(`DeployCoordinator` already builds a `SiteGraphExplorerSnapshot` from pages/posts):

- publication: site display name, `SITE_URL`, description from site settings; icon blob later.
- document: `site` (publication at-URI), `title`, `description`, `path`, `publishedAt`,
  `updatedAt`, `tags` from post frontmatter, and `textContent` (plaintext render of the body).
  The `content` open union is deliberately left out — the lexicon leaves format to platforms,
  and our canonical format is the git repo; `textContent` is enough for indexers.

### 4. Template side (app-only, no paired PR)

- `/.well-known/site.standard.publication` joins the existing well-known claim inventory as an
  app-owned claim, emitted at build when `ATPROTO_DID` is present in `.site-config`.
- The base layout emits `<link rel="site.standard.publication">` (site-wide) and
  `<link rel="site.standard.document">` (per post) the same way. No new npm dependencies —
  this is a few lines in the existing head component + a well-known entry, consistent with the
  embeds scripts that already handle `at://` URIs.

### 5. Sequencing and pass mechanics

New `StandardSitePublishCommand` actor modeled on `POSSESyndicationCommand`: best-effort, never
throws into the deploy result, streams to the debug pane under a `standardsite:` source, ledgers
successes in `Config/`. It runs in `runPostDeploySequencing` **after webmentions, before
POSSE** — records should exist by the time the POSSE cross-post lands so Bluesky's preview
enhancement sees them (and a future increment can set `bskyPostRef` on the document after the
POSSE pass returns the post URI).

Publishing runs **on the host, from Swift** — never inside the container guest. The app
password stays out of the guest environment entirely, consistent with
`guestEnvAllowlist` admitting only `CLOUDFLARE_API_TOKEN`
([DeployExecutor.swift](../../../Sources/AnglesiteCore/DeployExecutor.swift)).

Ordering note: the *first* deploy after enabling publishes records whose well-known/link-tag
counterparts only go live on that same deploy — verification is bidirectional but not atomic.
That is fine: indexers re-crawl, and by the end of the deploy both ends exist. A site whose
`SITE_URL` is still the scaffold default (`https://example.com`) never publishes — the pass
gates on a real deployed URL, same as POSSE.

### 6. Opt-in surface

One toggle in site Settings next to the Bluesky account fields: "Publish posts to the
Atmosphere" — default **on** once a Bluesky account is connected (the app advises; connecting
the account *is* the owner's intent to be on that network). Consequence-phrased copy, no
protocol jargon beyond "Atmosphere" (#1004's naming).

### 7. Unpublish (v1.1)

Deleting a post should delete its document record (`com.atproto.repo.deleteRecord`; removals
detected by diffing the ledger against the current content graph). Spec'd but deferrable — a
stale record degrades to a dead canonical link, not a broken site.

## Alternatives considered

- **Run Sequoia in the container.** Rejected: new third-party dependency (needs approval), puts
  the app password inside the guest, adds state-file noise to `Source/`, and duplicates what ~200
  lines of Swift on existing seams do.
- **Adopt `astro-standard-site`.** Rejected: publishes at build time, which puts credentials and
  network writes inside the build container and inverts our publish-after-verify ordering.
- **Model as a `DeployTarget`.** Rejected: wrong shape — standard.site is syndication metadata,
  not hosting. §5.5's no-abstraction decision stands.
- **Wait for `@dwk/atproto-pds`** (self-hosted PDS, §5.6 / V-5 #339). Orthogonal: that is about
  *hosting* atproto data; this design works against the owner's existing Bluesky PDS today and
  would work unchanged against a self-hosted one later.

## Increments

1. **Core records + pass** — record structs, `putRecord`/`uploadBlob` support in the XRPC
   client, `StandardSitePublishCommand`, DID persistence, sequencing hook. Swift-testable with
   the existing `POSSEHTTPTransport` stub seam.
2. **Template verification** — well-known claim + head `<link>` tags, gated on `ATPROTO_DID`.
   (`swift test` includes template-coupled tests.)
3. **Settings toggle + debug-pane surfacing.**
4. **v1.1** — `bskyPostRef` linkage, publication icon / `coverImage` blobs, unpublish.

Paired-PR status: none needed — no MCP schema change; template changes are app-only.

## Open questions

- Grapheme-limit enforcement (title 500, description 3000) — truncate Swift-side with
  `String` grapheme counting; needs a shared helper.
- Multiple documents mapping to one path after a slug rename: deterministic rkeys keyed on path
  mean a rename creates a new record and orphans the old one — unpublish (v1.1) covers it;
  until then it's the same dead-link degradation as deletion.
- Whether pages (not just posts) should get documents. v1: posts only, matching the POSSE
  eligibility set.
