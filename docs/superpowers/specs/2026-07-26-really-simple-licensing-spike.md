# Really Simple Licensing (RSL) — research spike

**Date:** 2026-07-26
**Status:** Recommendation — pending decomposition into implementation issues
**Issue:** [#689 — Add support for Really Simple Licensing](https://github.com/Anglesite/Anglesite-app/issues/689)
**Related:** [#334 — Personal Publishing OS epic](https://github.com/Anglesite/Anglesite-app/issues/334), [#693 / #408 — crawler policy + Content Signals](https://github.com/Anglesite/Anglesite-app/issues/408), [`.well-known` support design](2026-07-14-well-known-support-design.md)

## Recommendation

**Do not implement "RSL support" as a feature.** Implement **per-content-type content
licensing**, and emit RSL as one of four projections of that model.

Three findings drive this:

1. No AI crawler honors RSL. Publishing `rsl.xml` from an Anglesite site changes no crawler
   behavior today, and the enforcement path that does work is CDN-mediated, not file-mediated.
2. Anglesite already emits two AI-crawler signals. RSL would be a third, and it is the only
   *conditional* one — so a free-form RSL editor lets a user publish a self-contradicting site.
3. The template emits **no licensing signal at all today** — no Microformats2 `u-license`, no
   schema.org `license`, no `<link rel="license">`, no rights statement anywhere. That gap is the
   real problem behind #689, and the vocabularies that fix it have actual consumers.

Reframed this way, RSL rides along at marginal cost on work that pays off immediately, instead of
being a standalone bet on a ten-month-old standard.

## What RSL is

RSL 1.0 is an XML vocabulary in the namespace `https://rslstandard.org/rsl`. A document maps
`<content url>` patterns to a `<license>` containing:

| Element | Purpose |
|---|---|
| `<permits>` / `<prohibits>` | `type="usage"` (`all`, `ai-all`, `ai-train`, `ai-input`, `ai-index`, `search`), `type="user"` (`commercial`, `non-commercial`, `education`, `government`, `personal`), `type="geo"` (ISO 3166-1 alpha-2) |
| `<payment type>` | `free`, `attribution`, `subscription`, `crawl`, `purchase`, `training`, `use`, `contribution`; with `<standard>`, `<custom>`, `<amount currency>`, `<accepts>` |
| `<copyright>` | rights holder, `type="person"`/`"organization"`, `contactEmail`/`contactUrl` |
| `<terms>` | URL of human-readable legal text |
| `<legal>` | `type="warranty"`, `"disclaimer"`, `"attestation"`, `"contact"`, `"proof"` |
| `<schema>` | linked or inline schema.org JSON-LD |
| `<reporting>` | telemetry/provenance/audit obligations |

Prohibitions take precedence over permissions, and the most restrictive applicable license wins.

### Discovery surfaces (five)

1. **Standalone file** — an `.xml` document at a publisher-chosen path. RSL does **not** register a
   `.well-known` suffix, so this is a root artifact in the `robots.txt` class, outside the scope of
   the [`.well-known` design](2026-07-14-well-known-support-design.md).
2. **robots.txt** — a `License:` directive, global or scoped inside a `User-agent` group.
3. **HTTP header** — `Link: <…>; rel="license"; type="application/rsl+xml"`.
4. **HTML** — `<link rel="license" type="application/rsl+xml">` in `<head>`, or an inline
   `<script type="application/rsl+xml">` scoped to an element.
5. **RSS/Atom** — `xmlns:rsl` namespace module, `<rsl:content>` per `<item>`.

### Layered protocols (all out of scope)

RSL 1.0 also specifies **OLP** (an OAuth 2.0 extension with `/token`, `/introspect`, `/key`
endpoints), **CAP** (`Authorization: License`, 401/402/403 responses), and **EMS** (symmetric
encryption of paywalled media keyed to a license). These require a license server, key management,
and payment rails. Nothing in Anglesite's static-site-plus-Worker architecture calls for them, and
nothing below assumes them.

## Q1 — Does anyone honor it?

**Publisher adoption is real. Crawler adoption is zero.**

RSL launched 2025-09-10 and the 1.0 specification was formalized in December 2025. It is managed by
the RSL Collective, a nonprofit co-founded by RSS co-creator Eckart Walther and former Ask.com CEO
Doug Leeds. Membership is free, non-exclusive, and imposes no dues; the Collective's revenue model
is a percentage of royalties it brokers.

- **Publishers:** Reddit, Yahoo, Medium, Quora, Ziff Davis, and MIT Press at launch; Arena Group,
  BuzzFeed, USA Today Co, and Vox Media since. The standard claims 1,500+ participating
  organizations.
- **Model developers:** none. As of this writing no foundation-model developer has publicly
  committed to honoring RSL 1.0. OpenAI, Google, Anthropic, and Meta declined to comment on
  compliance; xAI, Mistral, and Amazon have made no public statement.
- **Infrastructure:** Cloudflare, Akamai, and Fastly were named as launch supporters and can gate
  crawler traffic on license status. This is the enforcement path that actually functions — but it
  is the **network refusing the request**, not a crawler reading and respecting an XML file. It
  requires being on those vendors' products, and it is a superset of what Cloudflare's own
  Pay-Per-Crawl already does without RSL.

**Consequence for Anglesite.** For a personal site, emitting `rsl.xml` today has no behavioral
effect. Its value is entirely declaratory: a durable, timestamped, machine-readable record that
terms were expressed, plus an explicit reservation under EU Directive 2019/790 Article 4. That is
not worthless — but it must be labeled honestly in the UI rather than presented as protection.

**Revisit trigger.** If any of OpenAI, Google, Anthropic, or Meta publicly commits to reading RSL,
or if Cloudflare exposes RSL as a first-class input to AI Crawl Control, the cost/benefit changes
and this document should be re-evaluated.

## Q2 — Does it conflict with what we already emit?

**Yes — and resolving that is the substantive engineering content of this work.**

The template already emits two AI-crawler signals, both generated from `.site-config` by
[`scripts/edge-artifacts.ts`](../../../Resources/Template/scripts/edge-artifacts.ts) and both
surfaced in the Website Settings crawler-policy facet via
[`CrawlerPolicyAsset`](../../../Sources/AnglesiteCore/CrawlerPolicyAsset.swift):

| Key | Emitted as | Semantics |
|---|---|---|
| `BLOCK_AI` | `Disallow:` records for 17 named agents in `robots.txt` | **access control** — unconditional |
| `CONTENT_SIGNALS` | `Content-Signal: search=…, ai-input=…, ai-train=…` | **preference** — unconditional, per purpose |

RSL would be a third signal on the same subject, and it is the only **conditional** one: "you may
`ai-train` *if* you attribute / pay / are non-commercial." Two contradictions are trivially
reachable by a user checking boxes in the existing settings UI:

- `BLOCK_AI=true` emits `Disallow: /` for GPTBot while `rsl.xml` declares
  `<permits type="usage">ai-train</permits>` with `<payment type="attribution">`. RSL's
  most-restrictive-wins rule makes the permission dead letter; the site simply reads as incoherent.
- `Content-Signal: ai-train=no` directly contradicts `<permits type="usage">ai-train</permits>` —
  and both are advertised **from the same `robots.txt`**, since RSL's `License:` directive lives
  there too.

**Design consequence.** RSL must not ship as a free-form XML editor, and must not ship as an
independent settings facet bolted next to the crawler policy. Anglesite needs **one policy model**
with the three emissions as derived projections, so a contradiction is unrepresentable rather than
merely discouraged. This unification is worth doing on its own merits: today `BLOCK_AI` and
`CONTENT_SIGNALS` are already two independently-editable controls over overlapping subject matter.

## Q3 — Is the legal posture safe to ship by default?

**Safe, with one hard exclusion.**

RSL carries no independent legal force. Outside counsel characterizes it as "largely a request and
instruction system," noting that bots need not agree to the publisher's terms. The legal theory is
contract-by-conditional-access, layered on the EU DSM Article 4 text-and-data-mining opt-out
reservation. Enforceability is explicitly an open question in the published legal commentary.

The published [default terms](https://rslstandard.org/rsl/default-terms) impose obligations on the
*consumer* ("You must review and comply with the permissions, prohibitions, and compensation terms
… before accessing, copying, or processing any Covered Content") and grant no publisher warranties.
Referencing them via `<terms>` is therefore low-risk.

**The hazard is `<legal>`.** `type="warranty"` (`ownership`, `authority`, `no-infringement`,
`privacy-consent`) and `type="attestation"` are affirmative assertions the site owner makes about
content they may not own. This template's collections make that risk structural, not hypothetical:
of the ten routed collections, `bookmarks`, `replies`, `likes`, and `reviews` are *by construction*
about other people's work, and `photos` and `albums` routinely contain third-party subjects.

**Rules this establishes:**

- Anglesite **never** generates `<legal type="warranty">` or `<legal type="attestation">`. Not by
  default, not behind a checkbox in a settings pane. If it is ever offered, it needs its own
  deliberate, plain-language flow explaining what the user is asserting and about which content.
- `<copyright>`, `<terms>`, `<legal type="contact">`, and `<payment type="attribution">` with a
  `<standard>` Creative Commons URL are safe to generate and are honest statements of fact the app
  already knows (site owner, contact, chosen license).
- `<reporting>` is not generated — a static site cannot receive telemetry reports, and declaring an
  endpoint that 404s is worse than declaring nothing.
- Joining the RSL Collective is a user account action on `rslcollective.org`. The app does not
  broker it, does not prompt for it, and does not store credentials for it. The antitrust
  commentary in the legal literature attaches to the Collective's pooled negotiation, not to a
  publisher emitting a file, so it does not constrain this design — but it is another reason the
  app should stay out of the membership business.

## Q4 — Does it fit the Personal Publishing OS thesis?

**The thesis points at a bigger, more useful feature than RSL.**

The finding that reframes #689: **the template emits no licensing signal whatsoever today.** A grep
across `Resources/Template/src` for `license` and `copyright` returns nothing —
[`schema.ts`](../../../Resources/Template/src/lib/schema.ts) maps every routed collection to a
schema.org type (`Article`, `BlogPosting`, `SocialMediaPosting`, `ImageObject`, `ImageGallery`,
`WebPage`, `Comment`, `Event`, `Review`) and sets no `license` property on any of them,
[`Hentry.astro`](../../../Resources/Template/src/layouts/Hentry.astro) emits
no `u-license`, [`BaseLayout.astro`](../../../Resources/Template/src/layouts/BaseLayout.astro)
carries feed, IndieAuth, and Webmention links but no `rel="license"`, and no footer states terms.

Two things follow.

**Site-wide licensing is the wrong shape.** The ten routed collections in
[`collections.ts`](../../../Resources/Template/src/lib/collections.ts), plus `blog` on its own
route, are not homogeneous. A
site owner can meaningfully license their `notes`, `articles`, `blog`, and `photos`. They cannot
assert CC BY over a `like` of someone else's post, a `bookmark` of someone else's article, or the
quoted subject of a `review`. Per-content-type licensing is the correct model — and it is a
Personal Publishing OS feature in its own right, orthogonal to RSL.

**RSL is not the vocabulary with consumers.** Three alternatives are older, simpler, and actually
read today:

| Vocabulary | Consumer | Cost |
|---|---|---|
| schema.org `license` on `CreativeWork` | Google (image rights metadata in Search) | one field in `schema.ts` |
| Microformats2 `u-license` on `h-entry` | IndieWeb readers, parsers already consuming this site's mf2 | one link in `Hentry.astro` |
| `<link rel="license">` | long-registered, generic; the CC ecosystem | one line in `BaseLayout.astro` |
| RSL `rsl.xml` + robots `License:` | none confirmed | a generator + conflict model |

The first three are near-free once a per-type license model exists. RSL then becomes a fourth
projection of the same model.

## Proposed design

### One model, four projections

Introduce a **content licensing policy** as the single source of truth, owned by the same
`.site-config`-plus-Swift-asset pattern already used by `CrawlerPolicyAsset` and
`MTAStsPolicyAsset`:

```
                    ┌──────────────────────────────┐
                    │  Content licensing policy    │
                    │  · default license           │
                    │  · per-collection overrides  │
                    │  · AI usage permissions      │
                    │  · copyright holder/contact  │
                    └───────────────┬──────────────┘
                                    │
        ┌───────────────┬───────────┴───────┬────────────────┐
        ▼               ▼                   ▼                ▼
  schema.org       mf2 u-license      <link rel=          rsl.xml +
  `license`        on h-entry          "license">         robots License:
  (schema.ts)      (Hentry.astro)      (BaseLayout)        (edge-artifacts.ts)
                                                                │
                                    also derives ───────────────┤
                                    Content-Signal + BLOCK_AI ───┘
```

The bottom edge is the important one: `Content-Signal` and the `BLOCK_AI` blocklist become
**derived** from the same AI-usage permissions that produce `<permits>`/`<prohibits>`, rather than
being separately editable. That makes the Q2 contradictions unrepresentable.

### Per-collection licensing

The policy carries a site default plus per-collection overrides. Collections that are inherently
responses to third-party work default to **no license assertion** — the app emits nothing rather
than claiming rights it cannot verify:

| Collections | Default |
|---|---|
| `blog`, `notes`, `articles`, `photos`, `albums`, `announcements`, `events` | site default license |
| `bookmarks`, `replies`, `likes`, `reviews` | no assertion (emit nothing) |

A user can override any of these; the defaults just refuse to assert on their behalf.

### Storage

`.site-config` is a flat `KEY=value` file and cannot carry a per-collection structure without
becoming unreadable. Precedent exists for a sibling JSON artifact —
`Resources/Template/redirects.json` — read by a build script. The licensing policy follows that
shape: a committed, git-visible, hand-editable `licensing.json` in `Source/`, with the site-wide
scalars (`COPYRIGHT_HOLDER`, contact) staying in `.site-config` where the rest of the site identity
lives.

### UI

One Website Settings facet, "Content Licensing," which **absorbs** the existing crawler-policy
controls rather than sitting beside them. The RSL emission is a single disclosure-style toggle
inside it, labeled honestly — something to the effect of *"Also publish RSL. No AI company
currently honors this standard; it records your terms in machine-readable form."* This follows the
BBEdit-style labeling convention the LLM policy already established for capability claims.

### Explicitly out of scope

- OLP, CAP, EMS — no license server, no `Authorization: License` handling, no encrypted media.
- Any payment type other than `free` and `attribution`. `crawl`, `purchase`, `subscription`, and
  `training` imply payment rails the app does not have and cannot honor.
- `<legal type="warranty">` and `<legal type="attestation">` (see Q3).
- `<reporting>` — no telemetry endpoint exists.
- RSL Collective membership.
- Inline per-element `<script type="application/rsl+xml">`. The per-collection model covers the
  same need with one document.

## Phasing

Each phase is independently shippable and independently valuable. Later phases can be abandoned
without stranding earlier ones.

1. **Licensing model + the three consumed projections.** `licensing.json`, per-collection
   resolution, schema.org `license`, mf2 `u-license`, `<link rel="license">`, footer rights
   statement. Ships real, read-today metadata; no RSL.
2. **Unify the AI signals.** ✅ Shipped — `BLOCK_AI` and `CONTENT_SIGNALS` are folded into the
   policy's `usage` block as derived projections, and the crawler-policy facet is absorbed into
   Website Settings ▸ Licensing. See
   [the phase 2 design](2026-07-27-ai-signal-unification-design.md).
3. **RSL projection.** ✅ Shipped (#992) — `rsl.xml` generator in `edge-artifacts.ts`, `License:`
   directive in `robots.txt`, `<link rel="license" type="application/rsl+xml">`, `Link:` header via
   `csp.ts`, `xmlns:rsl` module in the feed renderers. Conformance check in `pre-deploy-check.ts`.
   See `src/lib/rsl.ts`.

Phase 3 is the one gated on the Q1 judgment. If RSL adoption stalls further, phases 1 and 2 still
stand on their own.

## Open questions

- Whether the site-default license should ship as a required onboarding choice or default to
  "all rights reserved" (the legal default) with an opt-in to something more permissive. Leaning
  toward the latter — asserting a permissive license on a user's behalf is the same class of
  mistake as generating a warranty.
- Whether `licensing.json` or a Keystatic singleton is the better home once the Keystatic
  integration matures. `redirects.json` precedent argues for plain JSON now.
- Whether the RSL `<content url>` patterns should be per-collection route globs (`/notes/*`) or
  enumerate entries. Globs are far cheaper and match how the routes are structured; per-entry only
  matters if per-entry license overrides are ever added.

## Sources

- [RSL 1.0 Specification](https://rslstandard.org/rsl) — normative element and protocol reference
- [RSL default access terms](https://rslstandard.org/rsl/default-terms)
- [The Register, 2025-09-11 — "New RSL spec wants AI crawlers to show a license or pay"](https://www.theregister.com/software/2025/09/11/new-rsl-spec-wants-ai-crawlers-to-show-a-license-or-pay/1292571)
- [The Register, 2025-12-10 — "Really Simple Licensing spec makes AI orgs pay to scrape"](https://www.theregister.com/2025/12/10/really_simple_licensing_spec_takes/)
- [Crowell & Moring — "How Really Simple Licensing May Change Online Content Licensing"](https://www.crowell.com/en/insights/client-alerts/how-really-simple-licensing-may-change-online-content-licensing)
- [Digiday — publishers joining the RSL Collective](https://digiday.com/media/arena-group-buzzfeed-usa-today-co-vox-media-join-rsls-ai-content-licensing-efforts/)
- [Plagiarism Today — "AI Licensing Comparison: RSL vs. Pay-Per-Crawl"](https://www.plagiarismtoday.com/2025/09/11/ai-licensing-comparison-rsl-vs-pay-per-carwl/)
- [Cloudflare Content Signals Policy](https://blog.cloudflare.com/content-signals-policy/) — the directive `edge-artifacts.ts` already emits
