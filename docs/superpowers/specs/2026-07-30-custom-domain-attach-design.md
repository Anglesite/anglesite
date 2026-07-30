# Attaching a transferred custom domain during deploy

**Date:** 2026-07-30
**Status:** Approved — ready for an implementation plan
**Issue:** [#1077 — Deploy never attaches the custom domain for "Transfer an existing domain" sites](https://github.com/Anglesite/Anglesite/issues/1077)

## Problem

The New Site wizard's "Transfer an existing domain" option (`NewSiteWizard.swift`) persists
`DOMAIN_CHOICE=transfer` and `DOMAIN=<value>` into `Source/.site-config`, but nothing in the deploy
pipeline ever attaches a Cloudflare Workers Custom Domain or creates DNS records from it. Deploy
silently falls back to the `*.workers.dev` subdomain with no indication the intended custom domain
was never wired up. Confirmed via code search: `resolveSiteURL` in `DeployCoordinator.swift` reads
`DOMAIN`/`SITE_DOMAIN` only to pick the *internal* canonical-URL string for a composed Worker's
`SITE_URL` var — it never calls Cloudflare to actually route the hostname.

The app already has the Cloudflare building blocks this needs: `HTTPCloudflareClient.resolveZoneID`
(zone lookup by domain name), `CloudflareWriting`'s DNS record read/write, and
`workerScriptNames`'s account-ID resolution pattern (`/accounts?per_page=1`). What's missing is the
Workers Custom Domain attachment call itself and the deploy-time wiring to invoke it.

## Scope

Only the "Transfer an existing domain" path (`DOMAIN_CHOICE=transfer`). "Buy a domain" already
correctly stays a manual out-of-app step (a link to Cloudflare's registrar); "Set this up later"
persists no domain at all. Full automation, per the issue's preferred resolution: when the domain's
zone is already on the connected Cloudflare account, attach it for real; when it isn't (nameservers
not yet delegated — something the app cannot automate), say so explicitly instead of silently
presenting workers.dev as the final answer.

## Cloudflare API surface: `attachWorkersCustomDomain`

New method on `CloudflareWriting`/`HTTPCloudflareClient`:

```swift
func attachWorkersCustomDomain(
    hostname: String, workerScriptName: String, apiToken: String
) async throws -> CustomDomainAttachResult
```

```swift
public enum CustomDomainAttachResult: Sendable, Equatable {
    case attached
    case alreadyAttached
    case zoneNotFound
    case conflict(ownedBy: String)
}
```

Implementation, mirroring `workerScriptNames`'s and `checkWorkerNameConflict`'s existing shapes:

1. Resolve the account ID (`/accounts?per_page=1`, same as `workerScriptNames`).
2. Resolve the zone ID via the existing `resolveZoneID(domain:apiToken:)`. Not found → return
   `.zoneNotFound` (the domain isn't using Cloudflare nameservers yet — nothing more to do).
3. `GET /accounts/{account_id}/workers/domains?hostname={hostname}` to check for an existing
   attachment before writing anything:
   - No existing record → `PUT /accounts/{account_id}/workers/domains` with
     `{zone_id, hostname, service: workerScriptName, environment: "production"}` → `.attached`.
   - Existing record with `service == workerScriptName` → `.alreadyAttached` (idempotent no-op,
     no API write).
   - Existing record with a *different* `service` → `.conflict(ownedBy: thatService)`. Never
     silently repoint another Worker's custom domain — same "don't take over" principle as
     `checkWorkerNameConflict` (#740).

## Deploy-time wiring

New `CustomDomainAttachCommand` in `AnglesiteCore`, shaped like `SocialWorkerProvisionCommand`
(injectable `tokenSource`, injectable Cloudflare client seam so tests can fake network calls). One
method:

```swift
func attach(siteDirectory: URL, workerScriptName: String) async -> CustomDomainAttachCommand.Result
```

which reads `.site-config` itself (`DOMAIN_CHOICE`, `DOMAIN`, `CF_DOMAIN_ATTACHED`) and:

- Returns `.skipped` immediately when `DOMAIN_CHOICE != transfer`, `DOMAIN` is empty, or
  `CF_DOMAIN_ATTACHED` is already `"true"` — no network call in the common "later"/"buy"/
  already-attached cases.
- Otherwise calls `attachWorkersCustomDomain` and maps the result:
  - `.attached` or `.alreadyAttached` → persist `CF_DOMAIN_ATTACHED=true` into `.site-config`
    (best-effort write, matching `DeployCommand.persistWorkerDeployed`'s pattern) → return
    `.confirmed(hostname:)`.
  - `.zoneNotFound` → return `.notConnected(hostname:)`. No persistence — every future deploy
    re-checks for free (cheap zone lookup), so delegation finishing mid-flight is picked up on the
    very next deploy with no user action.
  - `.conflict(ownedBy:)` → return `.conflict(hostname:, ownedBy:)`. No persistence.

`DeployCommand.deploy()` calls `CustomDomainAttachCommand.attach` right after a successful
`wrangler` step, in the same best-effort spot as today's `uploadSourceBundleIfConfigured` — a
failure or `.notConnected`/`.conflict` outcome here must never turn an already-successful deploy
into a `.failed` one. The outcome is threaded out via a new observer parameter,
`onDomainAttach: ((CustomDomainAttachCommand.Result) -> Void)?`, mirroring the existing
`onPreflight`/`onProgress` observer pattern — `DeployCommand.Result` itself is unchanged, since a
domain-attach outcome is orthogonal to whether the deploy succeeded.

## UI surfacing

Mirrors `SourceBundleStatus`'s existing pattern exactly (`DeployModel.sourceBundleStatus`, computed
after the `.succeeded` transition and rendered as a `DeployDrawerView` header caption):

New `DomainAttachStatus` enum on `DeployModel`, set from the `onDomainAttach` observer during
`runDeploy`:

- `.skipped` → no UI.
- `.confirmed(hostname:)` → no caption (nothing wrong to report), but the drawer's displayed URL —
  the header subtitle and the ShareLink/Copy URL/Open-in-browser targets, all currently sourced from
  `DeployCommand.Result.succeeded`'s workers.dev `url` — switch to the custom domain instead, via
  `DeployCoordinator.resolveSiteURL(siteDirectory:)`'s existing DOMAIN-first precedence. Otherwise a
  successful attach would be invisible: the user would keep sharing/opening the workers.dev host
  even though their real domain now works.
- `.notConnected(hostname:)` → inline caption in the header, same visual treatment as the existing
  "Code changes not yet deployed to the CMS bundle." line: *"example.com isn't connected yet — add
  it to Cloudflare and point its nameservers there, then redeploy."* Non-blocking, expected during
  the delegation window.
- `.conflict(hostname:, ownedBy:)` → a one-time sheet, mirroring `workerNameConflictPresented`'s
  presentation (a new `domainConflictPresented` flag + sheet view), since this is a rarer condition
  the user should consciously see rather than skim past in a caption: *"example.com is already
  connected to another site (worker-name). This deploy succeeded at its workers.dev address, but
  won't use example.com until that's resolved."* The sheet is dismiss-only (no in-app remediation —
  resolving a cross-Worker domain conflict is out of scope here); it does **not** block the drawer
  or prevent further deploys, since wrangler already succeeded by the time this check runs.

## Non-goals / explicitly deferred

- DNS record management beyond what the Workers Custom Domain attachment itself auto-manages —
  Cloudflare creates/maintains the necessary DNS record as part of the attachment; no separate
  `addDNSRecord` call is needed for this flow.
- Any in-app remediation for the conflict case (transferring the domain between Workers, deleting
  the other attachment). The sheet only informs.
- The "Buy a domain" path — already correctly out-of-app (links to Cloudflare's registrar).
- Retrying detection on a tighter cadence than "next deploy." No polling, no background check.
- Workers *environments* other than `production` — single default environment, matching the rest of
  this deploy pipeline.

## Testing

Follows the existing black-box seam-injection pattern used by `SocialWorkerProvisionCommand` and
`DeployCommand`'s own tests — fake `CloudflareWriting`/zone-resolution closures, no real network
calls.

- `Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift` — skip cases (no transfer domain,
  already attached), zone-not-found → `.notConnected` with no persistence, fresh attach →
  `.confirmed` + `CF_DOMAIN_ATTACHED` persisted, already-ours re-check → `.confirmed` with no
  redundant API write, foreign conflict → `.conflict` with no persistence and no attach attempt.
- `Tests/AnglesiteCoreTests/HTTPCloudflareClientTests.swift` (or wherever existing Cloudflare-client
  tests live) — `attachWorkersCustomDomain`'s three branches against a fake transport.
- `Tests/AnglesiteAppTests/DeployModelTests.swift` — `onDomainAttach` outcomes drive
  `domainAttachStatus` correctly, and `.confirmed` swaps the drawer's URL to the custom domain while
  `.notConnected`/`.conflict` leave the workers.dev URL in place.
- Manual QA (hosted-app-only, per this repo's CI limitations for `DeployModel`): run the wizard's
  transfer-domain path against a real Cloudflare account with a zone already delegated, confirm
  attach + URL swap; against a domain not yet delegated, confirm the caption; fake a conflict by
  pre-attaching the hostname to a throwaway Worker, confirm the sheet.
