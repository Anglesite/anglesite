# In-app domain search + purchase via Cloudflare Registrar API (#1195)

**Status:** Approved design, not yet implemented.
**Issue:** [#1195](https://github.com/Anglesite/Anglesite/issues/1195)
**Follow-up to:** `docs/superpowers/specs/2026-07-31-publish-time-domain-step-design.md` (#1180) ▸ Follow-ups §2
**Spun off:** [#1204](https://github.com/Anglesite/Anglesite/issues/1204) — porting Cloudflare OAuth to macOS (see §6)

## Problem

#1180 shipped `ConnectDomainSheetView`/`ConnectDomainModel`: a "Buy a domain" button that
opens `https://www.cloudflare.com/products/registrar/` in the browser and records a
`DOMAIN_CHOICE=buy` intent marker, with no further app involvement. That was the deliberate
placeholder — Cloudflare's Registrar API was still beta at the time, and `register` needs a
billing profile + payment method + registrant contact + Domain Registration Agreement
acceptance already on file for the account, none of which have an API. Anglesite must never
collect, proxy, or auto-fill payment/card details on the owner's behalf.

Search and real-time pricing, however, are fully embeddable today with no hand-off needed, and
`register` itself can run entirely in-app for any account that's already completed that
one-time Cloudflare-dashboard setup trip. This issue replaces the placeholder link-out with a
real search → price → purchase flow, detecting the "needs dashboard setup" case by attempting
`register` and mapping its outcome, rather than trying to probe billing state directly.

## Goals

- Search domain name candidates from a keyword/phrase, with real-time availability and pricing.
- Purchase a domain in-app for accounts that already have Cloudflare billing/registrant/ToS set
  up, reusing the existing "I already own a domain" attach machinery once purchased (a
  Cloudflare-registered zone and a nameserver-delegated one need identical Workers Custom Domain
  attach logic).
- Detect the "this account needs a one-time Cloudflare-dashboard trip first" case by attempting
  `register` and mapping `action_required`/`blocked` outcomes to a clear hand-off message,
  rather than a confusing generic failure.
- Never collect, store, or proxy payment/card details.

## Non-goals

- Renewals or transfers via the Registrar API (not available upstream yet).
- Registrant-contact management beyond what a purchase requires (there is no API for it either).
- Domain registrar/expiration tracking for already-connected domains — that's #1194, a distinct
  capability with its own design.
- Porting Cloudflare OAuth sign-in to macOS. `CloudflareOAuthClient`/its callback Worker (#890,
  #891) were built for the **`AnglesiteMobile`** iOS target under epic #71 and require
  macOS-specific work (Associated Domains entitlement, `ASWebAuthenticationSession` presentation,
  scope selection, a manual `apple-app-site-association` update) that's genuinely a separate
  project. Spun off as [#1204](https://github.com/Anglesite/Anglesite/issues/1204). This design
  uses the existing macOS "no token" flow (`CloudflareTokenPromptView`) instead — see §6.
- Background/long-lived polling for a registration stuck `in_progress` past the bounded inline
  wait — see §3's "still processing" outcome.

## The Cloudflare Registrar API (beta)

Confirmed against the current docs (`https://developers.cloudflare.com/registrar/registrar-api/`)
since this API launched after training-data cutoff — endpoint shapes here should be re-verified
against the docs at implementation time, field-for-field, before writing the HTTP client:

All operations are **account-scoped** (not zone-scoped), resolved the same way
`workerScriptNames`/`attachWorkersCustomDomain` already resolve an account id
(`GET /accounts?per_page=1`, first result):

| Operation | Method | Path |
|---|---|---|
| Search | `GET` | `/accounts/{account_id}/registrar/domain-search?q={query}&limit={n}` |
| Check | `POST` | `/accounts/{account_id}/registrar/domain-check` |
| Register | `POST` | `/accounts/{account_id}/registrar/registrations` |
| Poll registration status | `GET` | `/accounts/{account_id}/registrar/registrations/{domain}/registration-status` |

- **Search** returns candidate domain names for a keyword/phrase (cached server-side).
- **Check** takes `{"domains": [...]}` (≤20 names) and returns, per name: `registrable`
  (bool), `reason` (e.g. `domain_unavailable`, `extension_not_supported_via_api`,
  `extension_not_supported`, `extension_disallows_registration`) when not registrable, and
  `pricing` (`registration_cost`/`renewal_cost` in the account's currency) when it is.
- **Register** takes `{"domain_name": "..."}` minimally. Cloudflare tries to complete it
  synchronously within a ~10s timeout and returns `201`; past that it returns `202` with a
  pollable status. The registration state machine is `in_progress → succeeded | failed |
  action_required | blocked`. Cloudflare's own guidance: stop polling on `failed` and
  `action_required`.
- `action_required`/`blocked` are the outcomes this design maps to "finish setup in the
  Cloudflare dashboard, then come back" — they're how an incomplete billing profile / registrant
  contact / ToS acceptance actually surfaces, since there's no API to check that state directly.

## Design

### 1. Entry point

`ConnectDomainSheetView`'s "Buy a domain" button (`.choosing` phase) changes from "open the
browser link + record intent + dismiss" to "dismiss this sheet, open the new purchase sheet."
`ConnectDomainModel.cloudflareDomainsURL` stays defined and becomes the escape-hatch link
surfaced inside the new sheet (§4) for owners who prefer registering directly on Cloudflare, or
whose domain needs a TLD the beta API doesn't support yet.

### 2. Architecture

Three new pieces, mirroring the existing `DomainModel` → `DomainOperationsService` →
`HTTPCloudflareClient` layering used for DNS record management:

- **`HTTPCloudflareClient`** gains `searchDomains`/`checkDomainAvailability` on
  `CloudflareReading` and `registerDomain` on `CloudflareWriting`. `registerDomain` owns the
  201-vs-202-and-poll distinction internally (see §3's bounded poll) so every caller above it
  sees one `async throws` call returning a single resolved outcome — no polling primitive is
  exposed at any layer above the HTTP client, matching how every other method on this client is a
  self-contained one-shot call.
- **`RegistrarOperationsService`** (protocol) + **`RegistrarOperations`** (prod impl), new files
  in `AnglesiteCore`, composing a `reader`/`writer`/`tokenProvider` exactly like
  `DomainOperationsService`/`DomainOperations`. New `RegistrarOperationError`: `.noToken`,
  `.cloudflare(CloudflareError)` — two cases, no `zoneNotFound` (not meaningful here).
- **`BuyDomainModel`** (`@Observable @MainActor`, new) + **`BuyDomainSheetView`** (new), in
  `AnglesiteApp`. Added to `SiteWindowModel` as `var buyDomain = BuyDomainModel()`, configured
  with `CurrentSite` the same way `domain`/`harden`/`connectDomain` are.

### 3. Data flow / phase machine

```swift
enum Phase: Equatable {
    case searching(query: String)                                   // pre-submit
    case loadingResults(query: String)                               // search + check in flight
    case results(query: String, candidates: [DomainCandidate])
    case confirming(candidate: DomainCandidate)                      // explicit price shown
    case purchasing(candidate: DomainCandidate)                      // register (+ bounded poll)
    case purchased(hostname: String)                                 // terminal success
    case needsAccountSetup(hostname: String)                         // action_required/blocked
    case stillProcessing(hostname: String)                           // poll exhausted, in_progress
    case needsToken(pendingQuery: String)                            // see §6
    case failed(reason: String)
}

struct DomainCandidate: Equatable, Identifiable {
    var id: String { name }
    let name: String
    let registrable: Bool
    let reason: String?              // set when !registrable
    let registrationCost: String?    // formatted, e.g. "$10.11/yr"; nil when !registrable
}
```

Flow: submit a query (explicit "Search" button / Return, matching `DomainSheetView`'s existing
`.onSubmit` convention — no live-as-you-type debounce) → `searchDomains(query:, limit: 20)` →
immediately batch `checkDomainAvailability` on all returned candidates in one call (≤20, fits the
API's per-request cap) → `.results`, available-first, unavailable/unsupported rows grayed out
with their `reason` as caption text and not selectable.

Tapping an available candidate → `.confirming`: explicit price, explicit "Buy `<domain>` for
`<price>`" button — this is a real charge against the payment method on file for the connected
Cloudflare account, so the button press is the only place `registerDomain` gets called, and it's
disabled for the duration of `.purchasing` (no double-submit).

`registerDomain` outcomes:

- **succeeded** → `ConnectDomainCommand.recordTransfer(hostname:, siteDirectory:)` (the exact
  same write "I already own a domain" already performs — see §5 for why) → `.purchased`.
- **failed** → `.failed(reason:)`. Nothing persisted.
- **action_required / blocked** → `.needsAccountSetup(hostname:)`: "Finish setting up billing in
  the Cloudflare dashboard, then come back and try again," with a link to the Cloudflare
  dashboard's domain registration page. Nothing persisted.
- **poll exhausted (still `in_progress`)** → bounded inline poll: every ~2s, up to ~15s total
  (matching the API's own "synchronous in most cases (10s timeout)" framing — 15s gives one
  margin past that before giving up). If still unresolved, `.stillProcessing(hostname:)`:
  "Still processing — once it finishes, come back and use 'I already own a domain' with
  `<hostname>` to connect it." Nothing persisted; no background task survives sheet dismissal.

### 4. Error handling

- **No Cloudflare token** — see §6.
- **Search/check network or API failure** — `.failed(reason:)`, reusing the same
  `CloudflareError`-case-to-message mapping `DomainModel.message(for:domain:)` already has
  (`unauthorized`/`http`/`api`/`malformedResponse`).
- **Per-candidate unavailability** — not an error; a non-selectable row with its `reason`.
- **Register failure / no double-charge** — covered in §3; only an explicit `succeeded` outcome
  ever reaches `.purchased`.
- **Escape hatch** — `.results`, `.needsAccountSetup`, `.stillProcessing`, and `.failed` all keep
  the "Buy directly on the Cloudflare dashboard instead" link
  (`ConnectDomainModel.cloudflareDomainsURL`).

### 5. Reusing the "transfer" write path

`ConnectDomainCommand.recordTransfer(hostname:, siteDirectory:)` writes `DOMAIN_CHOICE=transfer`
+ `DOMAIN=<hostname>` to `.site-config` and mirrors into `Source/anglesite.json`'s `domain`
section — exactly what `CustomDomainAttachCommand.attach()` already reads to attach a Workers
Custom Domain on the next deploy. A domain just registered via Cloudflare Registrar is, from that
point on, technically identical to a domain whose owner delegated its nameservers to Cloudflare:
both need the same resolve-zone-then-attach-Workers-Custom-Domain logic, and both already have a
live Cloudflare zone by the time this write happens. Reusing `recordTransfer` verbatim means
**zero changes to `CustomDomainAttachCommand`**. `DOMAIN_CHOICE` is an internal marker never shown
to the owner again, so the "transfer" label being technically imprecise for a bought domain is
invisible — the alternative (extending `CustomDomainAttachCommand` to also honor a `.buy` choice
carrying a hostname) was considered and rejected as unnecessary surface area for a distinction
that has no observable effect.

### 6. No-token handling reuses the existing macOS flow

macOS's established "no Cloudflare token" flow is `CloudflareTokenPromptView`, shown today by
`DeployModel` when neither the `CLOUDFLARE_API_TOKEN` env var nor the Keychain has one: a guided
modal (open Cloudflare's pre-filled token-creation page → paste → verify) backed by
`TokenOnboarding` (`AnglesiteCore`), which already owns the verify → persist → flash →
re-check-cancel → proceed ordering independent of any SwiftUI, and is designed to be driven by
injectable closures rather than a concrete model type.

`CloudflareTokenPromptView` itself, however, currently takes a concrete `let model: DeployModel`
and reads `model.tokenVerification`/calls `model.verifyAndSaveToken`. This design narrows it:

- Move the nested `TokenVerification` enum out of `DeployModel` to file scope in
  `CloudflareTokenPromptView.swift` (or `AnglesiteCore`, next to `TokenOnboarding`) so it's not
  owned by one specific model.
- Change `CloudflareTokenPromptView`'s `init` to `tokenVerification: TokenVerification,
  onSubmit: (String) async -> Void, onCancel: () -> Void` instead of `model: DeployModel`.
- `DeployModel`'s call site becomes
  `CloudflareTokenPromptView(tokenVerification: model.tokenVerification,
  onSubmit: { await model.verifyAndSaveToken($0) }, onCancel: onCancel)` — behavior unchanged.

`BuyDomainModel` gets its own `TokenOnboarding` instance (constructed the same way
`DeployModel.init` builds its own) and a `needsToken(pendingQuery:)` phase: entered when a search
attempt's `RegistrarOperationError` is `.noToken`. Presents the same (now-shared)
`CloudflareTokenPromptView`; on `TokenOnboarding.Outcome.proceed`, re-runs the search that was
pending instead of "start a deploy" (the only behavioral difference from `DeployModel`'s use —
what "proceed" means is caller-defined, already how `TokenOnboarding.run`'s `persist`/`onConnected`
closures are designed to work).

Porting actual OAuth sign-in to macOS (replacing this token-paste flow) is out of scope — see
[#1204](https://github.com/Anglesite/Anglesite/issues/1204).

### 7. Code shape

- **`Sources/AnglesiteCore/HTTPCloudflareClient.swift`**: add `searchDomains`,
  `checkDomainAvailability` to `CloudflareReading`; `registerDomain` to `CloudflareWriting`. New
  private `CFRegistrar*` decode structs alongside the existing `CF*` ones. `registerDomain`
  internally issues the `POST`, branches on `201` vs `202`, and — for `202` — polls the
  registration-status endpoint per §3's bounded loop before returning.
- **`Sources/AnglesiteCore/RegistrarOperationsService.swift`** (new): protocol + `RegistrarOperations`.
- **`Sources/AnglesiteApp/CloudflareTokenPromptView.swift`**: narrowed init per §6; `DeployModel`
  call site updated.
- **`Sources/AnglesiteApp/BuyDomainModel.swift`** (new): phase machine (§3), `TokenOnboarding`
  wiring (§6), `configure(site:)`.
- **`Sources/AnglesiteApp/BuyDomainSheetView.swift`** (new): search field, results list, confirm
  step, purchasing spinner, terminal states, escape-hatch link.
- **`Sources/AnglesiteApp/ConnectDomainModel.swift`**: `chooseBuy()` → dismiss + signal to open
  the new sheet (one call-site change; exact mechanism — a closure or the view reading both
  models — decided during implementation).
- **`Sources/AnglesiteApp/SiteWindow.swift`**: register
  `.sheet(isPresented: $model.buyDomain.sheetPresented) { BuyDomainSheetView(model: model.buyDomain) }`.
- **`Sources/AnglesiteApp/SiteWindowModel.swift`**: `var buyDomain = BuyDomainModel()`, configured
  alongside `domain`/`harden`/`connectDomain`.

### 8. Testing

- **`HTTPCloudflareClient` tests**: fixture JSON matching the real API's envelope shape for
  search, check (including every `reason` value), register (`201` immediate, `202` →
  poll-succeeded, `202` → poll-exhausted-still-`in_progress`, `action_required`, `blocked`,
  `failed`), and the existing `unauthorized`/`http`/`malformedResponse` mapping.
- **`RegistrarOperationsServiceTests`** (`AnglesiteCoreTests`): `.noToken` when the token
  provider returns nil; account-resolution failure folds into `.cloudflare`.
- **`BuyDomainModelTests`** (`AnglesiteAppTests`): full happy path (search → results → confirm →
  purchasing → purchased), asserting `ConnectDomainCommand.recordTransfer` is called with the
  purchased hostname; each terminal branch (`needsAccountSetup`, `stillProcessing`, `failed`);
  `needsToken` phase triggers token onboarding and resumes the pending search on
  `TokenOnboarding.Outcome.proceed`.
- **`CloudflareTokenPromptView`**: confirm `DeployModel`'s existing behavior is unchanged after
  the init narrowing (no new test needed if none exists today — just verify by inspection/build
  that the call site still compiles and behaves identically).
- Manual: build the app, open Connect a Domain → Buy a domain with no token configured (confirm
  the token prompt appears and resumes the search after saving), search a keyword, confirm price
  display and grayed-out unavailable rows, cancel out, complete a real purchase, confirm
  `.site-config`/`anglesite.json` afterward, confirm the escape-hatch link works from every
  non-happy-path state.

## Follow-ups (new issues, not in #1195)

1. **Port Cloudflare OAuth to macOS** — [#1204](https://github.com/Anglesite/Anglesite/issues/1204).
   Would let this feature (and Deploy generally) replace the token-paste flow with real OAuth
   sign-in. Needs its own design doc.
