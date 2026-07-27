# V-5 Communities — Design Spike (5.0)

**Date:** 2026-07-22
**Status:** Decided (DWK, 2026-07-22)
**Part of:** #367 (V-5.0 spike), #339 (V-5), #334 (pivot epic)
**Builds on:** `docs/specs/2026-06-26-personal-publishing-os-pivot-analysis.md` §5.6/§6.2,
`docs/specs/2026-06-29-c3-received-interaction-canonicality.md` (C.3),
`davidwkeith/workers` `spec/fediverse-interop.md` (FEP-1b12)

---

## 1. The corrected premise

#339 and the pivot analysis (§5.6) state the communities backend "already exists in
`@dwk/workers` (ActivityPub Groups + ATProto)." That is **half true**, and the half
matters:

- **Implemented:** FEP-1b12 group *participation* — following `Group` actors,
  addressing posts to a community via `audience`, and unwrapping the
  `Announce(<activity>)` envelopes groups relay. This is the vocabulary Lemmy,
  PieFed, Mbin, Friendica, Hubzilla, and PeerTube channels speak
  (workers #273–#276, closed July 2026).
- **Explicit non-goal:** *hosting* `Group` actors (the FEP-1b12 producer side).
  The workers spec defers it — "architecturally reachable" (the DO is keyed
  per-actor) but "a different product surface (moderation, membership, relay
  fan-out amplification) — revisit only with a concrete use case."

**V-5 is that concrete use case.** Hosting therefore needs a new upstream
`davidwkeith/workers` epic; it is not free. This splits V-5 into two stages.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Group model | **Staged: participate first, then host.** Stage 1 rides the shipped participation capability; Stage 2 hosts Group actors, with the upstream epic filed now. |
| D2 | Where a hosted community lives | **Its own `.anglesite` package** — own git repo (canonical archive), own Worker, own (sub)domain. Not a facet of a personal site. |
| D3 | Roles (first hosted version) | **Owner + moderators.** Join = `Follow`/`Join` with optional approval; owner appoints moderators; remove-post and ban-member. No finer roles. |
| D4 | Membership identity | **Any fediverse actor.** Members join from any ActivityPub account (an Anglesite site, Mastodon, Lemmy…). Group-hosted guest accounts are deferred. |
| D5 | Protocol lead | **ActivityPub Groups.** `@dwk/atproto-pds` stays exploratory — recorded, no V-5 tasking. |

## 3. Stage 1 — Participate (gated only on the V-3/V-4 app build)

An Anglesite site joins existing fediverse communities from its own domain. No
upstream work required.

**Join / leave.** Follow a `Group` actor by handle or URL (webfinger resolution is
already in the stack). Surfaced in a new **Communities** section of the site window:
joined groups, join/leave, per-group timeline.

**Read.** The Worker already classifies unwrapped group posts with their `audience`
IRI, so the V-4 reader (Microsub) filters "community posts" per group without new
protocol work. The Communities timeline is a reader view scoped to one group.

**Post.** A community post is **ordinary typed content in the member's own repo** —
canonical per #72 — with one schema addition: an optional `audience` field (Group
actor IRI) on the relevant typed-content schemas (notes, articles; extendable). The
AS2 projection maps it onto the existing `PostInput.audience` seam: `audience` set,
Group in `to`, and `kind: "page"` + title for Lemmy-style targets that require a
`name`. Frontmatter stays portable — a site built outside Anglesite renders
identically; `audience` only affects federation.

**Discovery (5.4) lands in Stage 1** per the plan's own constraint ("consume
existing open networks before building any directory"): browse/search existing
community directories (Lemmy instance lists, fediverse search endpoints) from the
join flow. No new centralized index, nothing to host.

## 4. Stage 2 — Host (upstream epic + app UX)

### 4.1 Upstream epic (`davidwkeith/workers`)

Filed as the deferred non-goal's concrete use case. Scope sketch (owned by the
workers repo, refined there):

- `Group`-typed actor configuration on the existing per-actor DO.
- Members = followers, with an optional approval gate (the
  `manuallyApprovesFollowers` analog; `Join`/`Leave` handled like `Follow`/`Undo`).
- Member-post handling: inbound activity from a member, membership validated →
  wrapped in `Announce`, fanned out to member inboxes (FEP-1b12 producer side).
- Moderation primitives: remove-post (`Undo Announce` + tombstone), ban-member
  (drop follower + reject future activities), and a **moderator list in actor
  config** — moderation activities accepted from listed actor IRIs, enforced
  Worker-side.
- Interop targets: Lemmy and Mastodon consuming a hosted group (the conformance
  harness already has a Lemmy peer).

### 4.2 A community is a site

Provisioning (5.1b) reuses the existing site-creation flow: a **group template
preset** in `Resources/Template` terms — home, about/rules, members page, and a
timeline built from snapshots (§4.3). Own Worker, own (sub)domain, one
security-scoped package like any other site. The owner's app session manages it;
**multi-editor app access is out of scope** (that's #399, unchanged).

### 4.3 Canonicality — C.3 multiplied, resolved by FEP-1b12

FEP-1b12 is author-owns-post: a member's post lives canonically **on the member's
own site/actor**; the group only relays it. So #72 holds without a multi-writer
git story:

- The **community repo** is canonical for group identity, rules, theme, and
  owner-authored content — like any site.
- **Announced member posts snapshot into the community repo's git** exactly like
  received interactions (C.3 flow: DO → JSON → git commit → push), as a sibling
  schema to `ReceivedInteraction` — same id/author/verification discipline, but a
  **fuller content cap** (the timeline *is* the page, unlike a comment thread) and
  an `audience`/`announcedAt` pair. One file per post; Astro's glob loader renders
  the timeline; git wins on divergence.
- **Moderation is the same motion as C.3 deletion:** remove = delete the snapshot
  file + `Undo Announce`; the member's canonical copy on their own site is
  untouched. Ban = drop the follower; their files stop arriving.

## 5. Retasking V-5 (#368–#371)

| Issue | Was | Becomes |
|---|---|---|
| #368 (5.1) | Group provisioning + membership UX | **5.1a Participate UX** (join/leave/post-to + Communities section; Stage 1) and **5.1b Hosted provisioning** (group preset + wizard; Stage 2) |
| #369 (5.2) | Group content on typed objects | **Stage 1:** `audience` field + AS2 projection. **Stage 2:** member-post snapshot schema + timeline templates |
| #370 (5.3) | Moderation tooling | **Stage 2 only** — surfaces the Worker primitives (report review, remove, ban) in the app |
| #371 (5.4) | Discovery | **Stage 1** — consume existing networks from the join flow |

**Gates:** Stage 1 on the V-3/V-4 app build (unchanged from #339). Stage 2
additionally on the upstream workers Group-hosting release (paired-release
coordination per the existing `@dwk/workers` seam: app decoding stays
backward-compatible, feature inert until the catalog publishes the group worker).

## 6. Spike acceptance (#367)

Met by this document: staged group model decided (D1–D5), backend decision
(ActivityPub Groups lead, hosting via upstream epic, ATProto deferred), and the
content mapping (typed content + `audience` in the member repo; C.3-style
snapshots in the community repo).
