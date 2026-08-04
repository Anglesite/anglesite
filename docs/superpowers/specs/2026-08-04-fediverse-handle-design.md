# Fediverse identity & handle — design (#1097)

- **Date:** 2026-08-04
- **Status:** Proposed
- **Issue:** [#1097 — Fediverse investigation](https://github.com/Anglesite/Anglesite/issues/1097)
- **Related:** [#363 — ActivityPub actor](https://github.com/Anglesite/Anglesite/issues/363),
  [#366 — WebFinger](https://github.com/Anglesite/Anglesite/issues/366),
  [#926 — outbox backfill](https://github.com/Anglesite/Anglesite/issues/926),
  the [well-known design](2026-07-14-well-known-support-design.md),
  the [v5 communities design](2026-07-22-v5-communities-design.md)

## Problem

The Fediverse is many platforms — Mastodon, Pixelfed, Friendica, Lemmy, Misskey, PeerTube —
and Anglesite's design calls for one identity, on the owner's own domain, that works across
all of them. Platform-specific onboarding (e.g. Pixelfed's apps steering users to official
servers) appears to break that: an account *on* Pixelfed would be `@owner@pixelfed.social`,
not the owner's domain. #1097 asks how to design this so a small-business owner owns their
identity, Anglesite supports arbitrary ActivityPub networks, and worker code stays minimal.

## Key finding: the single-handle constraint resolves the whole question

A Fediverse handle is a WebFinger lookup: `@user@domain` resolves via
`GET https://domain/.well-known/webfinger?resource=acct:user@domain`, and clients follow the
one link with `rel="self"` and `type="application/activity+json"`
([RFC 7033](https://www.rfc-editor.org/rfc/rfc7033.html),
[Mastodon WebFinger spec](https://docs.joinmastodon.org/spec/webfinger/)). Two consequences
shape everything:

1. **One handle maps to exactly one actor.** A JRD cannot hand two `rel=self` ActivityPub
   actors to one `acct:`. The single-identity requirement therefore *forces* a single actor —
   which Anglesite already has (`@dwk/activitypub`, one actor per site, V-4.1 #363).
2. **The platforms in #1097's list are servers, not networks.** A Pixelfed or Friendica user
   pastes the site's handle into search and follows the self-hosted actor directly — no
   Pixelfed account needed, and Pixelfed's official-servers restriction only affects people
   *hosting an account there*, not who its users can follow. "Support arbitrary ActivityPub
   networks" is not N integrations; it is one conformant actor whose posts carry shapes each
   platform renders.

So the messy story decomposes into three independent layers — **identity** (this spec's core:
the handle scheme), **reach** (what each platform's users actually see; a content-type
problem), and **hosting flexibility** (where subdomains legitimately fit, via WebFinger
delegation). Only the first needs a product decision now.

## Decision 1 — handle scheme: default `@example.com@example.com`

### Why not `@me@example.com`

Mastodon and most Fediverse clients truncate handles in timelines, notifications, and
follow lists to the bare username, showing the full `@user@domain` only on the profile.
A fixed `@me` username would render every Anglesite site as **@me** — indistinguishable in
exactly the surfaces where discovery happens. The same argument applies to the current
fixed `site` username (worker.ts's `ACTIVITYPUB_USERNAME`), which additionally reads as
infrastructure, not identity.

### The default: domain as username

The default handle is the site's domain in *both* positions:

```
@example.com@example.com
```

Truncated displays show **@example.com** — globally unique, self-describing, and an
advertisement for the site even when the domain half is cut off. This is an established
Fediverse pattern with proven interop: Bridgy Fed publishes web sites as
`@domain.tld@web.brid.gy` / `@domain.tld@domain.tld`
([Bridgy Fed docs](https://fed.brid.gy/docs)), and Threads federates dotted usernames
(`@user.name@threads.net`) that Mastodon resolves and follows without issue. Mastodon's
remote-username grammar accepts dots and hyphens in interior positions, so any registrable
hostname is a valid username.

Derivation: the username defaults to the serving origin's hostname with a leading `www.`
stripped (`www.example.com` → `example.com`); the handle's domain half is whatever host
answers WebFinger — the origin itself. Because the worker already computes `baseUrl` from
the request origin, **the default needs no configuration at all**: `worker.ts` uses the
hostname as `preferredUsername` when no override is set. A site previewing on
`*.workers.dev` gets a `workers.dev`-flavored handle, consistent with WebFinger authority
belonging to the origin (well-known design §"Origins and aliases"); the handle becomes
permanent only at first federation on the production domain (below).

### Owner-chosen username, mutable only before first federation

The owner may replace the username half (keeping the domain half fixed — it *is* the
WebFinger authority) any time **before the actor first federates**. After the actor has
accepted its first follower or delivered its first outbox activity, the handle is locked:
remote servers cache handles, follower relationships were formed under it, and a rename
would strand followers' mention/search paths even though follows themselves bind to the
actor IRI.

- **Validation:** case-insensitive `[a-z0-9_]` at both ends, `[a-z0-9_.-]` interior —
  the intersection of the `acct:` userpart (RFC 7565) and Mastodon's remote-username
  grammar. No length cap beyond WebFinger practicality (domains already exceed Mastodon's
  30-char *local* limit; remote handles have no such limit).
- **Lock signal:** app-side, derived from existing state — the followers collection is
  non-empty (`ActivityPubFollowersClient`) or the outbox ledger has entries
  (`ActivityPubOutboxLedger`). The worker does not enforce the lock; the app owns it, the
  same way it owns every other provisioning decision.
- **UI voice:** per the house rule (the app advises, phrased in consequences to the
  owner's site, never mechanics): *"This is how people find and follow you across social
  networks. Once someone follows you it can't change without losing them."* The field
  lives with the ActivityPub activation flow (Workers tab / first-deploy confirmation),
  pre-filled with the default — not a buried Settings pane the owner must discover.

### Storage and threading

The chosen username is public site identity, needed by the worker at request time and by
the build for `rel=me`/meta output — so it is **git-visible**, not app-private state:

- New `.site-config` key `AP_USERNAME` (absent = derive from hostname). `.site-config` is
  the established home for exactly this class of value (`SITE_URL`, `DOMAIN`, `SITE_NAME`),
  and the domain-config investigation (2026-07-31, #1095) already treats it as the
  template-owned identity record.
- Threaded into the composed worker as an `AP_USERNAME` wrangler var by
  `WorkerComposition.generateWranglerToml`, exactly like `AP_DISPLAY_NAME` today.
- `worker.ts`: `preferredUsername = env.AP_USERNAME ?? originHostnameMinusWWW`, and the
  WebFinger resource map keys `acct:<preferredUsername>@<host>` to the actor.

### Actor IRI stays `/users/site` — permanently

The handle is display/discovery identity; the actor **IRI** is federation identity. Follows,
signatures, and caches bind to the IRI, so it must never change — and decoupling it from the
username is precisely what makes the username safely mutable pre-federation. The IRI keeps
its existing `/users/site` path forever (Bridgy Fed's actors likewise have IRIs unrelated to
their usernames; Mastodon derives the displayed handle from `preferredUsername` plus a
WebFinger round-trip, not from the IRI path). This also means the Micropub→AP fan-out,
route claims (`/users/` prefix), and the owner-publish endpoint are all untouched.

Mastodon's reverse-discovery check then works as: fetch actor at `/users/site` → read
`preferredUsername: "example.com"` → WebFinger `acct:example.com@example.com` → subject
matches, `rel=self` points back at `/users/site`. Displayed handle: `@example.com@example.com`.

### Migration for already-federated sites

Pre-1.0 there is no fleet to migrate, but the rule is cheap to state: a site whose actor
has already federated under `@site@host` keeps that handle (the lock applies); WebFinger
continues answering `acct:site@<host>`. A site with ActivityPub provisioned but zero
followers and an empty outbox silently adopts the new default on next deploy. In both
cases WebFinger additionally answers the *other* form as an alias whose JRD subject is the
canonical handle, so stale references resolve rather than 404.

## Decision 2 — reach is content-type work on the one actor, not new identities

What each platform's users see is a function of the AS2 objects the actor publishes:

| Platform | Follows a `Person`? | Renders |
|---|---|---|
| Mastodon, Misskey/*key, Threads | yes | `Note`; `Article` as title+link |
| Pixelfed | yes | **only posts with media attachments** ([Fedi.Tips](https://fedi.tips/pixelfed-photo-sharing-on-the-fediverse/)) |
| Friendica | yes | nearly everything |
| Lemmy / PieFed / Mbin | no (groups only) | `Page` announced into a `Group` — already the v5 Communities path |
| PeerTube | yes | `Video` only |

The one concrete defect this table exposes: the Micropub→AP fan-out builds a bare `Note`
from `content` only — it drops Micropub's `photo` property, so **a Pixelfed follower of an
Anglesite site today sees nothing at all**. Mapping `photo` → AS2 `attachment` (`Image`
objects) on the fanned-out Note is the single highest-leverage "Pixelfed support" change,
and it is the entire Pixelfed story — no Pixelfed-specific code exists or should. (Whether
`@dwk/activitypub`'s owner-publish endpoint passes `attachment` through determines if this
is app-only or needs a package release; the package lives in the `davidwkeith/workers`
monorepo, outside the sidecar pairing, so app-side changes stay backward-compatible per
CONTRIBUTING's catalog-coordination rule.)

Explicit **anti-goal:** native accounts on Fediverse platforms. If an owner wants a
presence a platform only offers via its own servers, that is POSSE — a *different* handle,
honestly labeled syndication, bound to the canonical identity with `rel=me` links and
`alsoKnownAs` on the actor — never something the app presents as the same identity. This
is exactly the existing Bluesky/Mastodon POSSE posture extended on principle.

## Decision 3 — subdomains are the hosting escape hatch, not the identity model

WebFinger delegation decouples where the actor is *hosted* from the handle's domain:
Mastodon's own `LOCAL_DOMAIN`/`WEB_DOMAIN` split serves `@alice@example.com` from
`mastodon.example.com`, with `example.com` merely redirecting `/.well-known/webfinger`
([Mastodon docs](https://github.com/mastodon/documentation/blob/archive/Running-Mastodon/Serving_a_different_domain.md)).
RFC 7033 permits the redirect, and the well-known design already blesses "dynamic **or
hosted-redirect**" WebFinger with HTTPS-only targets.

Anglesite adopts this as the *supported pattern held in reserve*: if the actor ever needs
to live off the apex (a site hosted where the worker can't run; hypothetical future heavy
fediverse software on `fed.example.com`), the apex needs only the WebFinger redirect and
the handle stays `@example.com@example.com`. Nothing is built now.

What subdomains **cannot** do is multiply identities. Multiple actors (a photos feed, a
blog feed) are necessarily distinct handles — one JRD, one `rel=self`. The v1 answer to
mixed content is one actor publishing everything and followers' clients filtering (which
they already do — Pixelfed shows only the media posts). Secondary actors are a possible
v2 (`@dwk/activitypub`'s Durable Object is per-actor keyed), framed as *additional*
handles like `@photos@example.com`, never as the primary identity splitting.

## Worker-code minimalism scorecard

| Change | Where | Size |
|---|---|---|
| `preferredUsername` default-from-hostname + `AP_USERNAME` override | `worker.ts` | small, app-only |
| WebFinger map: canonical + alias `acct:` forms | `worker.ts` | small, app-only |
| `AP_USERNAME` var emission | `WorkerComposition` | small, app-only |
| `.site-config` key + handle field UI + lock | app | moderate, app-only |
| `photo` → `attachment` fan-out | `worker.ts` (+ possibly `@dwk/workers` release) | small |
| Pixelfed / Friendica / Misskey support | — | **none** (same actor) |
| Lemmy support | — | **none** (v5 Communities, shipped path) |
| WebFinger delegation | — | deferred, redirect-only when needed |

## Open questions / follow-up checks

- **`host-meta` fallback:** some older Fediverse software discovers WebFinger via
  `/.well-known/host-meta` ([RFC 6415](https://www.rfc-editor.org/rfc/rfc6415.html);
  Mastodon still serves it). Verify whether `@dwk/webfinger` answers it; if not, a tiny
  XRD pointer is a candidate addition *in that package*, entering the well-known claim
  inventory like any other feature route.
- **Strict-validator interop:** dotted `preferredUsername` is proven against Mastodon,
  Pixelfed, and Threads; sweep Pleroma/Akkoma behavior during the conformance pass below.
- **Interop conformance pass:** follow + render verification of the actor from Pixelfed,
  Friendica, and Misskey (not just Mastodon), documenting what each platform's users see.

## Proposed issue decomposition

1. Handle scheme: default-from-domain, `AP_USERNAME` override, WebFinger aliasing, lock —
   app-only (this spec's core).
2. Attachment fan-out (`photo` → `attachment`) — the Pixelfed story.
3. Interop conformance pass across non-Mastodon platforms.
4. `host-meta` check in `@dwk/webfinger` (upstream).
5. Record the delegation pattern as reserved; close the "account on every network"
   direction as an anti-goal on #1097.

## Sources

- [RFC 7033 — WebFinger](https://www.rfc-editor.org/rfc/rfc7033.html)
- [RFC 7565 — the `acct` URI scheme](https://www.rfc-editor.org/rfc/rfc7565.html)
- [Mastodon WebFinger specification](https://docs.joinmastodon.org/spec/webfinger/)
- [Mastodon: serving a different domain](https://github.com/mastodon/documentation/blob/archive/Running-Mastodon/Serving_a_different_domain.md)
- [Bridgy Fed documentation](https://fed.brid.gy/docs)
- [Fedi.Tips — Pixelfed](https://fedi.tips/pixelfed-photo-sharing-on-the-fediverse/)
- [W3C ActivityPub Recommendation](https://www.w3.org/TR/activitypub/)
- [RFC 6415 — Web Host Metadata](https://www.rfc-editor.org/rfc/rfc6415.html)
