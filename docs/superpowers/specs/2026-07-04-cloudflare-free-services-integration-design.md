# Cloudflare Free Services — First-Class Integration Design

**Date:** 2026-07-04
**Status:** Approved design, pending implementation plans
**Prompt:** [Cloudflare's commitment to free](https://blog.cloudflare.com/cloudflares-commitment-to-free/) — which free Cloudflare services should become first-class Anglesite integrations, and in what order.

## 1. Context

Anglesite already integrates deeply with Cloudflare:

| Already integrated | Where |
|---|---|
| Workers deploy (static assets + social worker) | `DeployCommand`, `DeployExecutor`, `WorkerComposition`, `SocialWorkerProvisionCommand` |
| D1 / KV / R2 provisioning (social worker bindings) | `WorkerComposition` |
| Web Analytics (beacon injection, GA migration) | `CloudflareWebAnalyticsClient`, `WebsiteAnalyticsAsset` |
| DNS / DNSSEC / SPF / DMARC / CAA | `HTTPCloudflareClient`, `HardenPlanner`, `SecurityAudit` |
| SSL mode, Always-HTTPS, HSTS, security headers | `SecurityAudit`, `HardenExecutor` |
| Bot Fight Mode, free-plan WAF custom rules (5) | `HardenPlanner` |
| API token onboarding + Keychain storage | `TokenOnboarding`, `CloudflareAPITokenVerifier`, `CloudflareTokenPromptView` |

The #462 integrations wizard catalog (`IntegrationDescriptor` / `IntegrationCatalog` / `IntegrationWizardModel` / `IntegrationScaffolder`) provides a declarative seam — providers, fields, conditions, operations (file copy, config write, anchor injection, CSP domains) — that new integrations plug into without new framework code.

This design adds the free (or at-cost) Cloudflare services that are *not* yet integrated, as nine vertical slices on existing seams.

## 2. Decisions (from brainstorming)

1. **Scope: all three lanes.** Site-owner wizard features, zone hardening/perf extensions, and third-party-provider reduction.
2. **CF default, keep others.** Where a Cloudflare service overlaps an existing catalog provider (contact → Formspree, tracking → Plausible/Fathom/GA4), Cloudflare becomes the recommended/default provider; existing providers remain selectable. No forced migrations. **Exception — email:** iCloud Custom Email Domains ships at launch as a *peer* of Cloudflare Email Routing, neither defaulted (see Slice 2).
3. **Free bar: at-cost extras included.** Generous free tiers qualify (Zaraz 1M events/mo, image transformations 5k unique/mo). Cloudflare Registrar (at-cost domains) is in scope. Paid-only products (Stream, Images storage) are out.
4. **One "Anglesite" token.** A single custom token template covering all permissions the app can use, replacing the current "Edit Cloudflare Workers" template. Capability probing gives graceful degradation for existing narrow tokens.
5. **Sequencing: vertical slices, value-first** (approach 1 of 3 considered; alternatives were harden-pack-first and a new top-level Cloudflare dashboard pane — the latter rejected as it bypasses the catalog and Harden seams).

Constraints inherited from the project:

- **#459:** all journeys are deterministic Swift/TypeScript (or Apple Intelligence). No new `claude --print` / markdown-skill paths. No external LLM APIs.
- **MAS sandbox:** all Cloudflare access is HTTPS API calls (`HTTPCloudflareClient`) or wrangler running inside the site container — no new host requirements.
- **Logs are sacred:** every API orchestration streams progress/failures to the debug pane.
- **The app cannot bypass `pre-deploy-check.sh`.**

## 3. Services considered and filtered out

| Service | Verdict | Why |
|---|---|---|
| Turnstile | **In (Slice 1)** | Free CAPTCHA; protects catalog forms |
| Email Routing + free sends | **In (Slice 2)** | Free forwarding; free Worker `send_email` to verified destinations enables CF-native contact form |
| Speed Brain, Zstandard, ECH, Page Shield monitor | **In (Slice 3)** | Free zone toggles/readbacks; direct Harden fit |
| Image transformations | **In (Slice 4)** | Now free on all plans (5k unique/mo) |
| Zaraz | **In (Slice 5)** | Free ≤1M events/mo; removes third-party JS from pages |
| Workers Logs (3-day) + tail | **In (Slice 6)** | Free; closes observability loop for deployed Workers |
| Registrar | **In (Slice 7)** | At-cost; API in beta (search/check/register, subset of TLDs) |
| AI Search (formerly AutoRAG) + NLWeb | **In (Slice 8)** | Free instance provisioning via REST; NLWeb Worker enablement is dashboard-only (public preview) — see [#691](https://github.com/Anglesite/Anglesite/issues/691) |
| Stream | Out | Paid product |
| Images storage/delivery | Out | Paid plan only (transformations free tier used instead) |
| Access / Tunnel / CASB / DLP / DEX / MNM | Out | Team/network products; no fit for static-site owners |
| Calls managed TURN | Out | No realtime feature in Anglesite |
| API Shield schema validation, Leaked Credential Checks | Out | No origin API / no login surface on static sites |
| Web Analytics, DNSSEC, WAF free rules, Bot Fight Mode | Already integrated | — |

## 4. Slice 0 — Unified "Anglesite" token (prerequisite)

**What:** Revise `TokenOnboarding` / `CloudflareTokenPromptView` to a single custom token template named "Anglesite" containing every permission the app can use:

- Existing: Workers Scripts (Edit/Account), Workers KV (Edit/Account), Workers R2 (Edit/Account), D1 (Edit/Account), Workers Routes (Edit/Zone), Workers Tail (Read/Account)
- Zone: Zone Settings (Edit), Zone Rulesets (Edit), DNS (Edit) — already exercised by Harden
- New: Turnstile (Edit/Account), Email Routing (Edit/Zone + Account destination addresses), Zaraz (Edit/Zone), Zone Analytics (Read), Page Shield (Edit — Harden enables the script monitor), Response Compression (Edit), Registrar (Edit/Account), AI Search (Edit/Account — added with Slice 8)

The guided token-creation URL (pre-filled permissions) is updated accordingly.

**Capability probe:** after signature verification, a `CloudflareCapabilityProber` performs cheap read probes per permission group and produces a `TokenCapabilities` set, persisted alongside the token reference. *(Implementation note: Slice 0 shipped the probe with `Codable` types but probe-on-demand only; persistence lands with the first consumer slice — Slice 1.)* Wizards and Harden check capabilities up front; a missing capability renders an inline "Upgrade your Cloudflare token" step that re-runs onboarding with the new template. Existing narrow tokens keep working for everything they already do — no forced re-mint.

**Testing:** verifier probe logic against a stubbed HTTP layer; capability-gating unit tests.

## 5. Slice 1 — Turnstile

**What:** a cross-cutting **"Protect with Turnstile"** bool field (not a new catalog entry) added to the `contact` and `newsletter` descriptors, available to future form integrations.

**Flow:** wizard creates a widget via `POST /accounts/{account_id}/challenges/widgets` (managed mode, domains = site apex + www) → captures `sitekey` (public) and `secret` (never written to disk) → injects the `https://challenges.cloudflare.com/turnstile/v0/api.js` script and `cf-turnstile` div via existing `injectAtAnchor` operations → pushes the secret as a Worker secret so the subscribe/contact Worker calls `siteverify` server-side. CSP domains extend via the catalog's existing `addCSPDomains` operation.

**Notes:** widget create/read requires `Account.Turnstile:Edit`/`Read` (API error 10000 signals missing scope → capability upgrade path). Re-running the wizard must not recreate the widget (that would rotate keys) — look up existing widget by name/domain first; idempotent like `SocialWorkerProvisionCommand`.

## 6. Slice 2 — Email Routing + Cloudflare-native contact form

**Deliverable A — new `email` integration descriptor ("Get you@yourdomain.com") with two peer providers:**

- **iCloud Custom Email Domains** (peer option, shipping at launch): full mailboxes via the user's existing iCloud+ subscription. The wizard pre-creates Apple's required DNS records on the Cloudflare zone (MX to `mx01/mx02.mail.icloud.com`, SPF include, DKIM CNAME with the Apple-provided values), then hands off to icloud.com for the domain-verification step Apple requires, and verifies the records afterward. Apple-first fit for the app's audience (successor to the `anglesite:email` skill's recommendation under #459).
- **Cloudflare Email Routing** (peer option): forwarding-only, no new mailbox.
  1. Enable Email Routing on the zone (adds MX/TXT via API).
  2. Create destination address → Cloudflare emails a verification link → wizard polls the API until verified ("check your inbox" step; resumable if the user quits).
  3. Create routing rule(s): named addresses (`hello@`, `contact@`…) and optional catch-all.

The two providers are **mutually exclusive MX owners**. The wizard reads current MX state first and treats it as either/or: switching providers is an explicit, confirmed step that replaces the records; pre-existing third-party MX (Google Workspace, Fastmail…) aborts with an explanation rather than clobbering. Neither provider is "default" — the wizard presents both as peers (iCloud = real mailboxes, needs iCloud+; Cloudflare = free forwarding to an inbox you already have).

**Deliverable B — contact wizard gains a "Cloudflare" provider (new default):** a Worker route `/api/contact` with a `send_email` binding whose `destination_address` is locked to the owner's verified address. Sends to verified destination addresses are free on all plans. Submissions are Turnstile-verified (Slice 1). `WorkerComposition` learns the `send_email` binding type in `wrangler.toml` generation. Formspree and mailto remain selectable.

**Deliverable B is provider-independent:** the contact-form Worker sends to any verified destination address — including an iCloud custom-domain mailbox once verified — so choosing iCloud email does not forgo the Cloudflare-native contact form.

**Interaction with Harden:** Harden already writes SPF/DMARC; the correct SPF answer now depends on the email provider (`include:_spf.mx.cloudflare.net` for Email Routing, `include:icloud.com` for iCloud). `HardenPlanner` must become email-provider-aware so the two features don't fight over TXT records.

## 7. Slice 3 — Harden pack

Extend `HardenPlanner` / `HardenExecutor` / `SecurityAudit` with newly free zone capabilities:

- **Speed Brain** — enable (perf; speculation rules).
- **Zstandard compression** — enable.
- **ECH (Encrypted Client Hello)** — enable.
- **Page Shield script monitor** — read-only: surface detected third-party scripts in the audit report, cross-referenced against the CSP domains the integration catalog knows it added (an unexpected script is a red flag).

Pure extension of the existing plan/execute/audit pattern; smallest slice. Audit/Harden App Intents pick these up automatically.

**Implementation note:** the audit currently lists detected script hosts without cross-referencing the integration catalog's CSP domains — the comparison described above (flagging scripts the catalog didn't add) is deferred to a follow-up.

## 8. Slice 4 — Image transformations

1. Enable transformations for the zone (one API call; capability-gated).
2. Template opt-in: production builds emit `/cdn-cgi/image/format=auto,width=…/<path>` URLs via an Astro image-service wrapper in `Resources/Template/` (dev builds and non-CF deploys emit plain URLs). Sharp keeps doing build-time resizing; the edge adds per-browser format negotiation (AVIF/WebP).
3. Quota safety: always include `onerror=redirect` so exceeding the 5,000 unique transformations/month free quota degrades to the original image, never a broken one. (Over-quota returns error 9422; no surprise billing on free.)

Template changes are app-only (no plugin pairing). Run `swift test` — Swift smoke tests couple to template markup.

## 9. Slice 5 — Zaraz provider

The `tracking` wizard gains a **"Cloudflare Zaraz"** provider (recommended when the site is on a CF zone): GA4/Meta/etc. are configured server-side via the Zaraz config API, so no third-party JS ships in the page at all. Zaraz consent mode maps onto the existing `consent` integration's categories (analytics/embeds/ads) instead of a bespoke banner when Zaraz is the tracker.

**Risk:** the Zaraz config API is a single JSON document (read-modify-write). The client must fetch, patch only Anglesite-managed tools (namespaced naming), and write back — never overwrite user-managed tools. This is the most schema-heavy slice; budget accordingly.

## 10. Slice 6 — Worker observability

Surface the deployed Worker's logs in the app's debug pane (today: local subprocesses only):

- **Workers Logs** (free 3-day retention) fetched on demand for the site's worker.
- Live **tail** (token already has Workers Tail read) while the debug pane is open.

Closes the loop for Slices 1–2: a failing contact-form submission is diagnosable in-app. Read-only; no schema changes.

## 11. Slice 7 — Registrar ("Get a domain")

Domain search → real-time availability/price check → registration, via the **beta** Registrar API, offered in the New Site wizard and as a standalone flow for existing sites on free subdomains.

Guardrails:

- **Explicit purchase confirmation** — the app never registers without a click-through showing the at-cost price. No App Intent for purchase.
- Beta TLD coverage is partial: unsupported TLDs get a prefilled dashboard-handoff link.
- Registration may be async — poll the workflow per API docs.
- Last in sequence: beta API + the only slice that spends money.

## 12. Slice 8 — AI Search / NLWeb

**What:** a self-contained AI Search feature (a dedicated Swift model + SwiftUI view, *not* a catalog descriptor) offering Cloudflare AI Search (formerly AutoRAG) as a site's conversational-search and agent-access layer. Prerequisite [#982](https://github.com/Anglesite/Anglesite/issues/982) (sitemap.xml generation) shipped 2026-07; the crawler can now index a site at all.

**Not a catalog descriptor, and why:** `IntegrationDescriptor`/`Operation` (`Sources/AnglesiteCore/IntegrationDescriptor.swift`) is pure local file/config templating — six operation cases, no live-network-call primitive, and no precedent for a blocking pre-check, a multi-step provisioning call, or a terminal dashboard-handoff step. The one existing "wizard step calls out live" precedent (`IntegrationOperationsService.plan`'s hardcoded `integrationID == .greenHostCheck` branch) is a single read-only GET folded into template answers — not enough to build on. This slice needs its own orchestration, the same conclusion the original investigation reached ("doesn't fit \[the catalog\] pattern either").

**Flow:**

1. **Preflight — crawler-policy check.** Read the site's policy via `LicensingStore.load()` (`Sources/AnglesiteCore/LicensingStore.swift` — already implements read/write against `Source/src/data/licensing.json`; no new licensing plumbing needed). `AIUsage.aiInput` is `"yes" | "no" | "unset"` (not "allow"/"deny"). If `aiInput == "no"`, block with an inline explanation and a link to crawler-policy settings — mirrors how Email Routing/iCloud abort on pre-existing third-party MX rather than silently overriding. `"unset"` (including an absent `licensing.json`, which loads as the empty/`NO_USAGE`-equivalent policy) asserts no objection and passes through.
2. **Preflight — cost and model disclosure.** Unlike every other slice in this doc, Workers AI/AI Gateway billing scales with reader traffic rather than being flat-free or one-time — a popular page can push a site past the free tier (10k neurons/day, then metered). Show an explicit at-cost disclosure requiring confirmation before provisioning, in the same spirit as Slice 7's purchase confirmation but for a metered cost. The same step states plainly that reader queries run on Cloudflare's models — this doesn't implicate the app-side #459 on-device policy (which governs app features, not published-site behavior) but the disclosure belongs here regardless.
3. **Provision the AI Search instance** via REST (`POST /accounts/{account_id}/ai-search/namespaces/{name}/instances`, website crawler source). No capability-gating framework exists yet for *any* slice (`CloudflareCapabilityProber`/`TokenCapabilities` have zero consumers today, and no "missing capability → upgrade prompt" UI exists to plug into) — this slice doesn't invent that machinery either. It attempts the call directly; a 403/permission error surfaces a friendly message pointing at token settings, matching how the rest of the app handles permission errors today. The Slice 0 token template documentation (Section 4) still lists `AI Search (Edit/Account)` as a permission to add when a token is (re)created, since that's just guidance text, not code this slice depends on.
4. **WAF skip rule.** If Bot Fight Mode is on, call `CloudflareWriting.createWAFCustomRule` directly with a skip rule allowing the `Cloudflare-AI-Search` crawler through. This is a self-contained call in the AI Search flow, **not** a change to `HardenPlanner.plan(from:domain:)`'s shared signature — that function takes only `state`/`domain` today and has no per-feature conditional-item precedent (the original design's claim that "Slice 2 already does this for email" doesn't hold in this codebase; extending `HardenPlanner` itself is out of scope for this slice).
5. **NLWeb dashboard handoff.** NLWeb enablement has no API and is public preview as of 2026-07 — the flow ends with a "finish setup in the Cloudflare dashboard" step: a prefilled deep link to the AI Search instance's Settings, plus the manual steps listed inline (locate "NLWeb Worker", enable it). Same shape as the iCloud-email handoff in Slice 2.

**Notes:**

- **No crawler-policy write-back.** `AIUsage` (`Resources/Template/src/lib/licensing.ts` / `LicensingStore.swift`) has no per-crawler allow-list — only blanket `search`/`aiInput`/`aiTrain` plus a single `blockAICrawlers` bool. `Cloudflare-AI-Search` was never in the `aiCrawlers` blocklist (`edge-artifacts.ts`) to begin with, so passing the step-1 preflight requires no policy change at all. A per-crawler allow-list is a real gap if fine-grained control is ever wanted, but building it is out of scope for this slice's MVP.
- **Route ownership deferred.** Because NLWeb enablement is dashboard-only, its Worker's routing (`/ask`, `/mcp`) is entirely Cloudflare's concern until NLWeb ships provisioning automation — this slice does not touch `WorkerComposition`/`WorkerRouteClaims`. Whether a future automated NLWeb becomes a route claim proxying to Cloudflare's Worker, or lives on a subdomain, stays an open question for that follow-up slice.
- **Preview risk.** Both AI Search and NLWeb are public preview; the REST surface this slice automates (instance provisioning) is the more stable of the two, but the whole feature can still move under us. Scoping to instance-provisioning + handoff (rather than waiting for or guessing at a stable NLWeb API) is a deliberate bet that this slice stays small enough to tolerate that.

**Testing:** hand-rolled `CloudflareReading`/`CloudflareWriting` mocks for instance-provisioning and WAF-rule calls, matching the `MockCloudflareReader`/`MockCloudflareWriter` pattern in `Tests/AnglesiteCoreTests/HardenExecutorTests.swift`; Swift Testing (`@Test`/`#expect`, not XCTest, per the rest of `AnglesiteCoreTests`); a unit test asserting the flow refuses to proceed when `aiInput == "no"`, and proceeds when it's `"unset"` or `"yes"`; live e2e behind `ANGLESITE_CF_E2E=1` like the rest.

## 13. Cross-cutting

- **Idempotency:** every wizard operation is create-if-absent; re-running a wizard converges instead of duplicating (pattern: `SocialWorkerProvisionCommand`).
- **Errors:** missing token capability → inline upgrade prompt; API failures stream to the debug pane with the raw response logged.
- **Secrets:** Turnstile secret and any future secrets go Keychain → Worker secret; never to disk, never to git.
- **Testing:** stub `CloudflareReading`/`CloudflareWriting` fakes in `AnglesiteCoreTests`; descriptor `validate()` tests; live e2e behind env flags (e.g. `ANGLESITE_CF_E2E=1`) like the container suites.
- **App Intents:** Email forwarding setup and the Harden additions get intents; Registrar purchase does not.
- **Config ownership:** all per-site integration state stays in the package `Config/` or in `Source/` per existing catalog conventions; nothing new enters git that shouldn't.

## 14. Sequencing summary

| # | Slice | Seam | Size |
|---|---|---|---|
| 0 | Unified token + capability probe | TokenOnboarding | S |
| 1 | Turnstile | Catalog (contact/newsletter) + Worker | M |
| 2 | Email Routing + CF contact form | New descriptor + WorkerComposition + Harden interplay | L |
| 3 | Harden pack (Speed Brain, Zstd, ECH, Page Shield) | HardenPlanner/Executor/Audit | S |
| 4 | Image transformations | Zone setting + Template | M |
| 5 | Zaraz provider | Catalog (tracking/consent) | L |
| 6 | Worker observability | Debug pane + Workers Logs API | M |
| 7 | Registrar | New Site wizard | M (beta-gated) |
| 8 | AI Search / NLWeb | Standalone model/view + direct `CloudflareWriting` calls + `LicensingStore` | M (preview-gated) |

Slices 1–7 all depend on Slice 0 (its capability-gating framework, once one exists — see Section 12's note that no slice has built this yet). Slice 2's contact form depends on Slice 1 (Turnstile). Slice 8 is independent of every other slice: it's self-contained (own provisioning call, own direct WAF-rule call, existing `LicensingStore`) rather than extending shared planning code, so it doesn't depend on Slice 0 landing first or on Slice 3's Harden-pack work. Everything else can reorder opportunistically.

Each slice gets its own implementation plan (`docs/superpowers/plans/`) when picked up, per the #242/#459 convention.

## 15. API facts verified (2026-07-04, Slice 8 facts added 2026-07-30)

- Turnstile widget CRUD: `POST /accounts/{id}/challenges/widgets` returns `sitekey` + `secret`; needs `Account.Turnstile:Edit`.
- Email Routing free on all plans; sends to **verified destination addresses** via Worker `send_email` binding / REST / SMTP are free on all plans and don't count toward quotas. Full Email Sending (arbitrary recipients) is Workers Paid — not required by this design.
- Image transformations: free plan includes 5,000 unique transformations/month; over-quota → error 9422, cached transformations keep serving, `onerror` can redirect to the original; no charges on free.
- Registrar API: beta (Apr 2025) — search, availability/pricing, programmatic registration for a subset of TLDs; registration is a pollable workflow.
- Blog-post freebies folded into Slice 3: Speed Brain, Zstandard, ECH, Page Shield script monitor, Security Analytics; Worker logs 3-day retention into Slice 6.
- AI Search (formerly AutoRAG) instance provisioning: `POST /accounts/{account_id}/ai-search/namespaces/{name}/instances`, website crawler source under `source_params.web_crawler.parse_options`; needs a sitemap or `robots.txt` `Sitemap:` line to crawl at all (shipped by #982). Free during open beta: 100 instances, 20k queries/month, 500 crawled pages/day per account.
- NLWeb: Microsoft's open protocol; Cloudflare's integration is public preview as of 2026-07 and confirmed still dashboard-only to enable as of 2026-07-30 (Dashboard → AI → AI Search → create instance → Settings → enable "NLWeb Worker"; no REST/wrangler path documented). Exposes `/ask` (conversational UI + widget) and `/mcp` (agent-addressable structured queries) once enabled.
- Workers AI / AI Gateway (what NLWeb's queries run on) bill separately from AI Search itself: 10k neurons/day free, then $0.011/1k — metered by reader traffic, unlike every other slice in this doc.
- Corrected 2026-07-30 against the actual codebase (not just Cloudflare's docs): `AIUsage.aiInput`/`.aiTrain`/`.search` are `"yes" | "no" | "unset"` (`Resources/Template/src/lib/licensing.ts`), not "allow"/"deny" as first drafted. `LicensingStore` (`Sources/AnglesiteCore/LicensingStore.swift`) already implements Swift-side read/write against `Source/src/data/licensing.json` — this predates Slice 8 and needed no new plumbing. `HardenPlanner.plan(from:domain:)` takes only `state`/`domain` with no per-feature extension point, and `CloudflareCapabilityProber`/`TokenCapabilities` have no consumers anywhere in `Sources/` — both corrected the initial Slice 8 draft, which had assumed this groundwork already existed.
