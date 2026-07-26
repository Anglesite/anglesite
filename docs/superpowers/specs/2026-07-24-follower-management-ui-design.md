# V-4.2: Follower management UI — design

Issue: [#364](https://github.com/Anglesite/Anglesite-app/issues/364) (part of
epic [#338](https://github.com/Anglesite/Anglesite-app/issues/338), V-4
Federation + reader). Gated on
[#363](https://github.com/Anglesite/Anglesite-app/issues/363) (V-4.1
ActivityPub actor), which shipped in
[PR #931](https://github.com/Anglesite/Anglesite-app/pull/931).

## Goal

Let a site owner see who follows their site in the Fediverse, from within
Anglesite. A new main pane (**Website ▸ Followers…**) lists the actor
collection the site's own deployed `@dwk/activitypub` actor already serves,
enriched with each follower's display name and avatar.

## What the shipped package actually supports

This section records what was verified against the published
`@dwk/activitypub@0.1.0-beta.5` tarball, not against its documentation — the
constraints below are what shape the scope.

- **Followers are readable with no new backend work and no authentication.**
  `GET https://<site>/users/site/followers` is forwarded straight to the
  Durable Object by the package's handler (its "Collection reads
  (authoritative; routed to the DO)" branch), with no signature or bearer
  check. The composed Worker exposes it through the already-published
  `/users/` prefix route claim.
- **Collection items are bare actor IRI strings.** The DO's `followers` table
  stores only `actor`, `inbox`, `shared_inbox`, and `added_at`. No display
  name, no avatar, no handle. Any richer presentation must come from fetching
  the remote actor documents.
- **There is no owner-side way to remove or block a follower.** The
  owner-publish endpoint's `#routeRelationshipActivity` special-cases exactly
  two activity types — `Follow` and `Undo(Follow)` — and both operate on the
  `following` table (who the *site* follows), never on `followers`. Any other
  activity the owner publishes is fanned out to *every* follower and mutates
  no follower row. A `Reject` or `Block` would therefore be broadcast to the
  whole audience and delete nothing.
- **Manual follower approval is out of scope in the package.** The actor
  document advertises `manuallyApprovesFollowers`, and the package's own
  config documentation parks approval as a C2S concern deferred past v1.

Consequently this slice is **view-only**. An owner-scoped remove/block endpoint
is filed against the `davidwkeith/workers` monorepo as
[davidwkeith/workers#447](https://github.com/davidwkeith/workers/issues/447); a
follow-up app issue consumes it once a beta ships. #364 closes on "view
followers", with the management gap recorded here and on the issue.

## Wire shapes

Two distinct AS2 documents, which is why the client models two calls rather
than one union type:

```jsonc
// GET /users/site/followers        → OrderedCollection
{ "@context": "...", "id": "...", "type": "OrderedCollection",
  "totalItems": 42,
  "first": ".../followers?page=1",   // present only when totalItems > 0
  "last":  ".../followers?page=3" }

// GET /users/site/followers?page=1 → OrderedCollectionPage
{ "@context": "...", "id": "...?page=1", "type": "OrderedCollectionPage",
  "partOf": ".../followers", "totalItems": 42,
  "orderedItems": ["https://mastodon.social/users/alice", "..."],
  "next": ".../followers?page=2",    // present only when a further page exists
  "prev": ".../followers?page=0" }   // present only when page > 1
```

Two consequences the design relies on:

- `first`/`last` are omitted entirely when `totalItems == 0`, so the genuine
  empty state is detectable from the first response without a second call.
- Paging follows the `next` link rather than computing
  `loaded == totalItems`. The server owns `pageSize`; the client should never
  need to know it.

Items are ordered `added_at DESC` — newest follower first.

## Architecture

The protocol, parsing, and security logic — the wire client, the actor-document
and avatar fetchers, the shared transport, the cache — all lands in
`AnglesiteCore`, which `swift test` covers on CI directly.

`FollowersModel` itself lives in the app layer, but "the app layer" here means
`AnglesiteAppCore`: a plain SwiftPM target (`Package.swift`) that
`Tests/AnglesiteAppTests` depends on and `swift test` exercises on CI like any
other target — it is not the same thing as a *hosted* app test. A hosted app
test (`xcodebuild test` with `Anglesite.app` as the test host) genuinely cannot
run on CI's older runners, because launching a macOS-27 `.app` needs
LaunchServices support CI's runner doesn't have. `FollowersModel` avoids that
path entirely by being plain, dependency-injected Swift with no
`xcodebuild`-only dependency, so it gets full CI coverage without a hosted
test. `FollowersView` stays thin SwiftUI glue with no logic of its own to
test.

### `AnglesiteCore` (new)

| Type | Responsibility |
|---|---|
| `ActivityPubFollowersClient` | Fetches the public collection. Injectable `Transport` closure mirroring `MicrosubClient.Transport`, but with no auth layer — no `authorize`, no DPoP proof, no nonce retry, because the collection is unauthenticated. `collection()` → `FollowersCollection` (`totalItems`, `firstPage`); `page(at: URL)` → `FollowersPage` (`items: [URL]`, `next: URL?`). |
| `ActorHandle` | Pure, no I/O. Derives `@alice@mastodon.social` from an actor IRI. Recognizes `/users/<name>`, `/@<name>`, and `/c/<name>`; returns `nil` for anything else so callers fall back to the raw IRI rather than inventing a wrong handle. |
| `ActorProfileFetcher` | Fetches one remote actor document. Injectable `Transport`, HTTPS-only, byte-capped, with a wall-clock deadline. Tolerant `icon` decoding: AS2 permits a string, an object, or an array of objects, and deployed instances ship all three. |
| `AvatarLoader` | Fetches one follower's avatar bytes under the same guards, since the icon URL is just as attacker-chosen as the document it came from. Returns raw `Data` so the caller can decode off the MainActor and against a pixel bound. |
| `CappedHTTPTransport` | The shared plumbing under both: an ephemeral `URLSession` carrying `timeoutIntervalForResource`, and a streaming fetch that aborts past a byte cap. |
| `ActorProfileCache` | Persisted enrichment store, modeled directly on `POSSESyndicationLog`: a `Sendable` struct with `static let filename`, `load(from configDirectory:)`, `save(to:)`, ISO-8601 dates, atomic write, and `nil` on a corrupt file rather than a throw. |

`ActivityPubActor.username = "site"` also lands in `AnglesiteCore`, beside
`WorkerComposition.activitypubWorkerID`.

### `AnglesiteApp` (new + wiring)

- `FollowersModel` — `@MainActor @Observable`. `configure(site: CurrentSite)`
  is called once per site open from `SiteWindowModel.loadAndStart()`, the same
  lifecycle hook `MicrosubReaderModel` uses. Owns the row list, paging state,
  the enrichment gate, and the cache instance. `resolveSite()` is split out of
  `configure` so `retry()` can re-read the site URL without a `CurrentSite`, and a
  generation counter lets an in-flight page discard itself across a `refresh()`.
- `FollowersView` — the pane. `.navigationSubtitle("Followers")`, matching
  `MicrosubReaderView`.
- Wiring: a `MainPaneMode.followers` case, `SiteWindowModel.presentFollowers()`,
  a `SiteWindow` switch arm, and a `Button("Followers…")` in `WebsiteCommands`
  beside `Reader…`. Like Reader and Cleanup, this pane has no toolbar or
  View-menu segment — the menu item is the only way in.

### Template coupling guard

The actor username `"site"` exists today only as `ACTIVITYPUB_USERNAME` in
`Resources/Template/worker/worker.ts`, with no Swift counterpart. The app must
build `/users/site/followers` itself, so a future template rename would break
this pane silently. `ActivityPubActorUsernameTests` reads the template file and
asserts the Swift constant matches, following the repo's existing precedent for
Swift tests coupling to `Resources/Template/`.

## Data flow

```
configure(site:)   → DeployCoordinator.resolveSiteURL(siteDirectory:) → siteURL
                   → ActorProfileCache.load(from: site.configDirectory)

pane opens         → collection()          → totalItems, firstPage
                   → page(at: firstPage)   → [actor IRI]
                   → rows paint at once: cached profile if fresh, else derived handle

row .task          → fresh cache hit (TTL 7 days)? use it, issue no request
                   → else enqueue through a max-4-in-flight gate
                   → success: update the row in place, mark the cache dirty
                   → failure: row keeps its derived handle; logged, not surfaced

"Load More"        → page(at: next) while the previous page carried a `next`
cache dirty        → save debounced ~2s after the last enrichment, and again
                     on pane disappear
```

The save is debounced rather than only on close so that a quit, crash, or
window close that never runs the disappear hook still leaves a warm cache —
enrichment work is wasted otherwise.

The cache persists the **icon URL**, never image bytes. `AvatarLoader` fetches
the image per visible row — keeping the `Config/` JSON small and avoiding
turning the app into an image store.

Each save **prunes entries past the TTL**. An expired entry is already invisible
to `profile(for:now:)`, so carrying it forward would only grow the file
monotonically with every follower the site has ever had and re-encode that
history on every debounced save. The save itself runs off the MainActor
(`Task.detached` over a value copy of the `Sendable` cache), so the encode and
atomic write never land on the main thread mid-enrichment.

`Config/` is the correct home because it is app-owned per-site state that must
never enter the site's git repo, per the `.anglesite` package model (#242).

A 7-day TTL suits the data: display names and avatars change rarely, and a
stale one for a few days costs nothing, while re-fetching every launch would
ping every follower's instance for no benefit.

## Error handling and security

Follower IRIs and display names are **attacker-supplied** — anyone in the
Fediverse can follow the site and thereby place a URL and a display string in
this pane. Every guard below follows from that.

**Outbound fetches** — `ActorProfileFetcher` for the actor document and
`AvatarLoader` for the avatar image, both built on `CappedHTTPTransport`:

- **HTTPS only.** Reject any scheme but `https` before issuing the request, and
  re-check the scheme of the *final* URL afterwards, so a redirect chain cannot
  downgrade to `http://` or divert to `file://`.
- **Streaming byte cap** — 256 KB for an actor document, 2 MB for an avatar. The
  cap has to be a streaming one: `URLSession.data(for:)` buffers the entire body
  before returning, so a post-hoc `data.count` check would already have accepted
  an arbitrarily large response. The default transport therefore uses
  `URLSession.bytes(for:)`, rejects early on an `expectedContentLength` over the
  cap, and aborts mid-transfer once accumulated bytes exceed it — checked every
  16 KB read buffer rather than every single byte, so the abort still lands
  well before the whole body arrives without paying a `Data` mutation on every
  byte. Both types additionally re-check `data.count` after the fact, so an
  injected test transport is held to the same limit.
- **A wall-clock deadline, not just an idle timeout.**
  `URLRequest.timeoutInterval` maps to `timeoutIntervalForRequest`, which bounds
  only how long a transfer may sit *idle* — a server that dribbles one byte
  every nine seconds never trips it and can hold a fetch open until the byte cap
  is reached. Because enrichment is gated on a small shared pool, a handful of
  such followers would starve every other row for the life of the window. Both
  fetches therefore run on their own ephemeral `URLSession` whose configuration
  sets `timeoutIntervalForResource` (settable only on a configuration, which is
  why neither can use `URLSession.shared`). An instance that hangs, streams
  without end, or drips slowly costs one row's label — never the pane.
- **Avatars do not go through `AsyncImage`.** It would hand a follower-chosen
  URL to `URLSession.shared` with no byte cap, no deadline, and no bound on
  decoded pixel dimensions — a larger attack surface than the actor document the
  guards were built for. Avatar bytes come from `AvatarLoader` and are decoded
  off the MainActor through ImageIO's thumbnail path at a 128px bound.
  `CGImageSourceCreateThumbnailAtIndex` genuinely subsamples during decode for
  JPEG (DCT scaling), but for PNG/GIF ImageIO generally decodes the full raster
  before downsampling — so the thumbnail call alone does not stop a small PNG
  that declares enormous dimensions from spiking memory. `FollowersView` closes
  that gap with a pixel-dimension precheck: it reads
  `kCGImagePropertyPixelWidth`/`kCGImagePropertyPixelHeight` via
  `CGImageSourceCopyPropertiesAtIndex` — metadata only, no raster decode — and
  rejects anything declaring more than 4096px on a side before the thumbnail
  call ever runs.
- **Bounded concurrency, 4 in flight — for both `ActorProfileFetcher` and
  `AvatarLoader`, independently.** `FollowersModel.maxConcurrentEnrichments`
  gates profile fetches; `AvatarLoader` gates avatar loads through its own
  actor-based semaphore (`AvatarLoader.maxConcurrentLoads`), since a realized
  `List` row's avatar `.task` fires independently of the enrichment queue —
  routing it through the same gate would couple two independent resources for
  no benefit, but leaving it ungated would let a `List` realizing dozens of
  rows (many with an already-cached, instantly-available icon URL) open dozens
  of concurrent 2 MB transfers at once. A site with thousands of followers must
  not fan out thousands of sockets on either path.
- **Failures are silent by design** — logged, never surfaced. The row keeps its
  derived handle.

**Rendering:**

- `name` and `preferredUsername` render as plain `Text` only; SwiftUI renders
  them literally, so markup in a display name is inert.
- `summary` is not displayed at all. It is the field most likely to carry HTML,
  and it earns nothing on a list row.
- **Open Profile** hands the actor IRI to `NSWorkspace.shared.open`, so it is
  subject to the same HTTPS-only check as a fetch — a follower must not be able
  to make the pane open a non-`https` URL scheme.
- Follower-supplied strings must never flow into a Foundation Models prompt.
  `@dwk/activitypub`'s own MCP tooling flags federated inbox content as
  prompt-injection surface; display names are the same class of untrusted data,
  and this app has live FM paths.

**Distinct states**, each with its own message, because each has a different
fix:

| Condition | Message |
|---|---|
| `resolveSiteURL` returns `nil` | Publish this site at least once first. |
| `503` from the actor route | ActivityPub isn't activated — point at the Workers settings toggle. |
| `404` / transport failure | The site is unreachable or its Worker isn't deployed. |
| `200`, `totalItems == 0` | Genuine empty state — show the actor URL to paste into Mastodon search. |

Every non-empty state above carries a **Try Again** button, and retry
**re-resolves the site URL** before reloading. Without that, the first two rows
of the table are dead ends by construction: they tell the owner to go publish
the site or turn ActivityPub on, and the pane could never notice they had —
`configure(site:)` runs once per window open, so nothing re-read `.site-config`
until the window was closed and reopened.

A **paging** failure is deliberately not one of these states. Paging is
additive, and these states render *instead of* the list, so routing a failed
"Load More" through them would hide every row already fetched. It surfaces as a
separate annotation beside the list instead, leaving the loaded rows in place.

The empty state does double duty as discovery guidance: until WebFinger ships
([#366](https://github.com/Anglesite/Anglesite-app/issues/366)), pasting the
raw actor URL into Mastodon's search field is the *only* way anyone can find
the site. A bare "No followers yet" would strand the owner at exactly the
moment they need a next step.

## Testing

`AnglesiteCoreTests`, all with fake transports and no real networking:

- `ActivityPubFollowersClientTests` — `OrderedCollection` and
  `OrderedCollectionPage` fixture decoding; `totalItems`; the
  `totalItems == 0` case with no `first`; a final page with no `next`;
  malformed JSON; non-2xx mapped to a typed error.
- `ActorHandleTests` — `/users/alice`, `/@alice`, Lemmy `/c/name`, and a
  UUID-path actor that must return `nil` (falling back to the raw IRI) rather
  than producing a wrong handle.
- `ActorProfileFetcherTests` — `icon` as string, object, and array; missing
  fields; oversize body rejected; non-HTTPS rejected; a redirect landing on
  `http://` rejected; the session configuration carries a wall-clock
  `timeoutIntervalForResource`, not just an idle timeout.
- `AvatarLoaderTests` — a normal response; oversize rejected; non-HTTPS
  rejected without issuing a request; a redirect landing on `http://` rejected;
  non-2xx mapped to a typed error; the same wall-clock deadline assertion;
  concurrent loads bounded at `maxConcurrentLoads`; a failing transport still
  releases its concurrency-gate slot (asserted by the suite's `.timeLimit`
  catching a leaked-slot deadlock rather than hanging forever).
- `ActorProfileCacheTests` — save/load round-trip, TTL expiry, a corrupt file
  returning `nil` without throwing, and `save` pruning expired entries out of
  the written file.
- `ActivityPubActorUsernameTests` — the Swift constant matches the template's
  `ACTIVITYPUB_USERNAME`.

The wall-clock deadline itself is asserted on the session *configuration*: it
only fires against a real, deliberately-slow server, which no unit test should
stand up.

`FollowersModel` is covered by `AnglesiteAppTests` (a SwiftPM target over
`AnglesiteAppCore` — no hosted app test needed) with a scripted in-process
followers server: retry recovering `.noSiteURL` after the site is published, a
paging failure leaving the loaded rows in place, overlapping `loadMore()` calls
appending each follower exactly once, and a page in flight across a `refresh()`
discarding itself. That is why the followers `Transport` is injectable into the
model rather than the client being built opaquely.

Verification also includes `xcodebuild` (a `swift test` pass alone does not
prove the `.app` links) and an `xcstrings` sync for the new user-visible
strings, per `CONTRIBUTING.md`.

## Scope

**In:** the follower list; follower count; paging via `next`; persisted profile
enrichment (display name + avatar); context-menu **Open Profile** and **Copy
Actor URL**; refresh; the four distinct states above.

**Out, with reasons:**

- **Remove/block a follower** — not expressible against
  `@dwk/activitypub@0.1.0-beta.5` (see "What the shipped package actually
  supports"). Filed as
  [davidwkeith/workers#447](https://github.com/davidwkeith/workers/issues/447);
  a follow-up app issue consumes the endpoint once released.
- **A "Following" list** — the collection exists and the client could serve it
  cheaply, but nothing in the app publishes a `Follow` yet, so the list would
  always be empty. Cut until something fills it.
- **Manual follower approval** — deferred in the package itself.
- **Export of the follower list** — Copy Actor URL covers the realistic need;
  a save-panel CSV/JSON export is new surface for a speculative one. Cheap to
  add back if it turns out to be wanted.

## Paired-PR posture

None required. This slice adds no MCP message-schema change (so no
`Anglesite/anglesite` sidecar PR) and no `catalog.json` change (so no
`davidwkeith/workers` PR blocking the merge). It consumes only routes that
`@dwk/activitypub@0.1.0-beta.5` already serves and that #363 already composed
into the template's Worker. The `davidwkeith/workers` issue filed for
remove/block is a *future* dependency, not a gate on this one.
