# Publish-time domain setup step: buy/transfer/later (#1180)

**Status:** Approved design, not yet implemented.
**Issue:** [#1180](https://github.com/Anglesite/Anglesite/issues/1180)
**Follow-up to:** `docs/superpowers/specs/2026-07-31-new-site-chooser-design.md` (#1071) ▸ Follow-ups §2

## Problem

The #1071 redesign removed the domain question from site creation entirely —
`.site-config` always gets `DOMAIN_CHOICE=later`, and the owner sees a live
preview seconds after picking a template. That's the right call for creation,
but it left nothing in the app that lets an owner ever change their mind: the
`NewSiteDomainChoice` enum (`buy`/`transfer`/`later`) and the machinery that
consumes it (`CustomDomainAttachCommand`, `SiteScaffolder`) are all still
there, but no UI writes `DOMAIN_CHOICE`/`DOMAIN` after creation. An owner who
wants to connect a real domain has no path to do it.

Separately, the existing "Domain…" toolbar/menu item (`DomainModel`/
`DomainView`) is a different tool entirely: a generic DNS-record editor that
takes any typed-in domain and manages its Cloudflare zone records. It has no
concept of "this site's domain" and isn't a fit for declaring domain intent.

## Goals

- Give the owner a way to declare buy/transfer/later for their site's domain
  after creation, feeding the same `.site-config` (`DOMAIN_CHOICE`/`DOMAIN`)
  and `Source/anglesite.json` (`domain` section) fields the retired wizard
  used to write, so `CustomDomainAttachCommand` and `DeployCommand` need no
  changes to consume it.
- Surface it once, naturally, right after the moment it becomes relevant —
  the site's first successful publish — without blocking or slowing that
  first publish down.
- Also make it permanently reachable on demand, for the owner who skips the
  first-publish nudge and comes back later.

## Non-goals

- Any change to `CustomDomainAttachCommand`'s attach logic, `DeployCommand`'s
  pipeline, or the `.notConnected`/`conflict` handling already in
  `DeployDrawerView` — this issue only adds a way to *declare* the choice
  that machinery already consumes.
- Domain registrar / expiration / renewal tracking — a distinct capability
  (an RDAP lookup, new persisted fields, a display surface) that deserves its
  own design. Filed as a fast-follow: #1194.
- Embedding an actual domain-purchase flow — "buy" still links out to
  Cloudflare Domains, matching the retired wizard.
- Renaming `NewSiteDomainChoice.transfer` / the `DOMAIN_CHOICE=transfer`
  `.site-config` value. Only the *user-facing copy* changes (see §2) — the
  internal identifier stays as-is since `CustomDomainAttachCommand` and
  `SiteScaffolder` already share it.

## Design

### 1. Flow & entry points

- **First-publish nudge.** `DeployModel` captures whether `.site-config`'s
  `CF_WORKER_DEPLOYED` flag was already set *before* starting a deploy
  (mirroring the read `DeployCommand.checkWorkerNameConflict` already does)
  and exposes it as `wasFirstDeploy`. If the deploy then succeeds and the
  flag wasn't set beforehand, this was the site's first successful publish.
  `DeployDrawerView`'s `.succeeded` header shows one extra line only in that
  case: *"Your site is live at `<slug>.workers.dev`. [Connect a domain…]"*.
  Because `CF_WORKER_DEPLOYED` is written permanently on that same deploy, the
  nudge structurally cannot reappear on a later deploy — no separate
  "already prompted" flag is needed.
- **Permanent access.** `Website ▸ Connect a Domain…`, next to the existing
  `Website ▸ Domain…` item, enabled whenever a site window is focused (not
  gated on a domain already existing — the whole point is this works
  *before* one does).
- Both entry points open the same sheet.

### 2. The sheet

`ConnectDomainSheetView` / `ConnectDomainModel`, phase machine:

- **`.choosing`**:
  - **"Buy a domain"** → `Link` out to Cloudflare Domains
    (`https://www.cloudflare.com/products/registrar/`), writes
    `DOMAIN_CHOICE=buy` (no hostname) as an inert intent marker, dismisses.
  - **"I already own a domain"** → reveals a `TextField` (placeholder
    `example.com`) with help text: *"Keep it at your current registrar —
    you'll add it to Cloudflare and point its nameservers there. We'll
    connect it automatically on your next Publish once that's done."* This
    wording is deliberate: `DOMAIN_CHOICE=transfer` does **not** mean
    transferring domain *registration* to Cloudflare — it means delegating
    the zone's nameservers to Cloudflare while the registrar of record stays
    unchanged. The retired wizard's "Transfer an existing domain" label
    invited exactly this confusion; the new copy states the actual mechanic
    plainly instead. This matches the existing `.notConnected` caption
    already in `DeployDrawerView` ("add it to Cloudflare and point its
    nameservers there, then redeploy"), so the language is consistent
    wherever the owner encounters it.
  - **"Not now"** → dismisses, writes nothing (`DOMAIN_CHOICE` stays
    `later`, already the default).
- **Submit** (owned-domain path, non-empty/trimmed hostname only — no
  stricter format validation, matching `DomainModel.resolveAndLoad`'s
  existing non-empty-only guard; a malformed hostname simply won't resolve a
  Cloudflare zone later, surfaced exactly like today's `.notConnected`
  outcome) → writes `DOMAIN_CHOICE=transfer` + `DOMAIN=<hostname>` to
  `.site-config` and mirrors into `Source/anglesite.json`'s `domain` section
  (`hostname`, `choice: "transfer"`, `attach: true`) — the same shape
  `CustomDomainAttachCommand.persistDomainIntent` already writes today, just
  triggered here instead of waiting for a deploy to fire it.
- **`.connected(hostname:)`** → *"We'll connect `<hostname>` on your next
  Publish."* + Done button.

No network calls happen in the sheet — only local file writes. The actual
attach attempt, and its `.notConnected`/`conflict` outcomes, stay entirely
owned by the existing `CustomDomainAttachCommand`, unchanged by this design.

### 3. Code shape

- **`Sources/AnglesiteCore/ConnectDomainCommand.swift`** (new): a plain type
  (no actor needed — synchronous file I/O only) with one entry point, e.g.
  `recordChoice(_ choice: NewSiteDomainChoice, hostname: String?,
  siteDirectory: URL)`, performing the `.site-config` + `anglesite.json`
  writes from §2. `CustomDomainAttachCommand.persistDomainIntent` is
  refactored to call this (or is inlined into it), so the write logic exists
  in one place instead of two near-duplicates.
- **`Sources/AnglesiteApp/ConnectDomainModel.swift`** (new): `@Observable
  @MainActor`, phase enum (`.choosing`, `.enteringHostname(String)`,
  `.connected(hostname: String)`), `openSheet()`/`dismissSheet()`/`submit()`
  following the `HardenModel`/`DomainModel` shape. Added to
  `SiteWindowModel` as `var connectDomain = ConnectDomainModel()`, configured
  with `CurrentSite` the same way `domain`/`harden` are.
- **`Sources/AnglesiteApp/ConnectDomainSheetView.swift`** (new): the view
  from §2.
- **`Sources/AnglesiteApp/DeployDrawerView.swift`**: one conditional line +
  button in the `.succeeded` header, gated on `wasFirstDeploy`, opening
  `model.connectDomain.openSheet()`.
- **`Sources/AnglesiteApp/DeployModel.swift`**: capture `wasFirstDeploy`
  before calling the deploy pipeline; expose it alongside `.succeeded` for
  the drawer to consult.
- **`Sources/AnglesiteApp/WebsiteCommands.swift`**: add `Button("Connect a
  Domain…") { model?.connectDomain.openSheet() }` next to the existing
  `Button("Domain…")`, enabled whenever a site is open.
- **`Sources/AnglesiteApp/SiteWindow.swift`**: register
  `.sheet(isPresented: $model.connectDomain.sheetPresented) {
  ConnectDomainSheetView(model: model.connectDomain) }`, matching how
  `harden`/`domain` sheets are already wired.

### 4. Testing

- `ConnectDomainCommandTests` (AnglesiteCoreTests): buy/transfer writes land
  correctly in both `.site-config` and `anglesite.json`; "not now" writes
  nothing; re-running with a new hostname overwrites the old one.
- `ConnectDomainModelTests` (AnglesiteAppTests): phase transitions,
  empty-hostname submit is a no-op.
- `DeployModelTests`: `wasFirstDeploy` is true only when `CF_WORKER_DEPLOYED`
  was absent before the deploy call, and stays false on every subsequent
  deploy for that site.
- Existing `CustomDomainAttachCommandTests` stay green — `persistDomainIntent`
  behavior is preserved, only relocated/shared.
- Manual: build the app, create a site, publish it, confirm the one-time
  banner appears; open the sheet from both entry points; confirm
  `.site-config`/`anglesite.json` after each of the three choices; confirm
  the banner does not reappear on a second deploy.

## Follow-ups (new issues, not in #1180)

1. **Domain registrar / expiration tracking** — [#1194](https://github.com/Anglesite/Anglesite/issues/1194).
   RDAP lookup (no API key required) for a connected domain's registrar and
   expiration date, persisted into `Source/anglesite.json`'s `domain`
   section and surfaced to the owner. Renewal reminders are explicitly out
   of scope for that issue too, pending the underlying data existing first.
