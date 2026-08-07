# Inbox capture: Settings UI to provision the `/inbox` Worker route + KV staging

**Date:** 2026-08-06
**Status:** Approved — ready for an implementation plan
**Issue:** [#764 — Inbox capture: Settings/wizard UI to provision the /inbox Worker route + KV staging](https://github.com/Anglesite/Anglesite/issues/764)

## Problem

#587 shipped the runtime inbox-capture path — a bespoke `/inbox` Worker route
(`Resources/Template/worker/worker.ts`'s `handleInbox`), `INBOX_KV` staging, and the app-side
git commit-back (`InboxSubmissionSync.pullAndCommitIfConfigured`) — but nothing in the app
provisions it. `SiteSettings.inboxCaptureAccountID`/`inboxCaptureKVNamespaceID` are storage slots
no UI fills in, so the route is unreachable for any user without hand-editing
`Config/settings.plist`.

Worse, `WorkerComposition.generateWranglerToml` already accepts `inboxCaptureEnabled`/
`inboxKVNamespaceID` parameters (it emits the route claim, `run_worker_first` entry, and
`[[kv_namespaces]]` binding when asked) — but its one production call site,
`SocialWorkerProvisionCommand.persistConfig`, never passes them. Even a manually-edited
`settings.plist` wouldn't reach a live deploy today; the composition logic and its only caller are
disconnected. The `/inbox` route in `worker.ts` is present unconditionally, but `env.INBOX_KV`
being unbound makes it always answer `500 "Inbox capture not configured"`.

## Scope

- A Settings surface that provisions inbox capture for a site: creates the `INBOX_KV` namespace,
  records the account ID + namespace ID, and wires `inboxCaptureEnabled` + the namespace ID
  through to `WorkerComposition.generateWranglerToml` so the `/inbox` route becomes live on the
  next deploy.
- A token-permission pre-check: friendly inline error if the stored Cloudflare token can't manage
  KV namespaces, before any provisioning is attempted.
- De-provisioning: turning it off stops routing (drops the route claim + binding from the next
  `wrangler.toml`) without deleting the KV namespace or its staged/synced submissions.

Out of scope: the `IntegrationDescriptor` → planner → scaffolder wizard pipeline. That pipeline is
pure local file/`.site-config` scaffolding — it never calls the Cloudflare API or provisions a live
resource (traced concretely via the `newsletter` integration, which instead copies a
self-deploy-it-yourself Worker + setup doc). It also already has an unrelated `IntegrationID.inbox`
case (a Keystatic-curated visitor-message inbox) that would collide semantically with "inbox
capture" in the UI. Neither the provisioning mechanics nor the naming fit; this feature is built as
an extension of the existing `SocialWorkerProvisionCommand`/Workers-tab pipeline instead.

## Data model

`provision()`'s existing `Result` cases (and `DeployModel`'s persistence of them) only carry state
back to `SiteSettings` through one channel: `WorkerComposition.ProvisionedResources`
(`resources:` on every `Result` case → `DeployCoordinator.persistProvisionedResources` →
`SiteSettings.provisionedWorkerResources`). `provision()` never reads `SiteSettings` itself — every
settings-derived input (`knownResources`, `siteURL`, `displayName`, `acknowledgesPaidPlan`) is
passed in explicitly by `DeployModel`, which already has `settings` in scope at its call site
(`DeployModel.swift:664-728`). There's no existing side channel for a provisioning run to hand back
a value that isn't shaped like `ProvisionedResources`.

Rather than invent a second, bespoke return path for the inbox KV namespace id and its owning
account id, this design folds both into `ProvisionedResources` (`SiteConfigStore.swift`), matching
its four existing resource-identifier fields (`d1DatabaseID`, `kvNamespaceID`, `r2BucketName`,
`queueName`, …) in shape and lifecycle (created once, durable across the feature being toggled off
and back on, resumable on a partial-failure retry via an `== nil` guard):

```swift
/// The provisioned `INBOX_KV` namespace id (#587, #764). `nil` until inbox capture's first
/// successful provisioning run.
public var inboxKVNamespaceID: String?
/// The Cloudflare account id that owns `inboxKVNamespaceID` — `InboxSubmissionSync` needs this
/// to address the namespace directly; every other client in this codebase re-resolves account id
/// live from the token instead of persisting it, but inbox capture's sync path runs independently
/// of any single deploy/provisioning call and needs a stable, already-resolved value.
public var inboxAccountID: String?
```

This makes the existing top-level `SiteSettings.inboxCaptureAccountID`/`inboxCaptureKVNamespaceID`
fields redundant — they are removed, and `InboxSubmissionSync.pullAndCommitIfConfigured`'s guard
clause is updated to read `settings.provisionedWorkerResources?.inboxAccountID`/`.inboxKVNamespaceID`
instead:

```swift
guard let settings = try? SiteConfigStore.read(from: configDirectory),
      let resources = settings.provisionedWorkerResources,
      let accountID = resources.inboxAccountID, !accountID.isEmpty,
      let namespaceID = resources.inboxKVNamespaceID, !namespaceID.isEmpty,
      let token = try? secretStore.readCloudflareToken(), !token.isEmpty
else { return 0 }
```

Removing the two unused top-level fields is safe: `SiteSettings` is a plist (`PropertyListDecoder`
silently ignores unknown/removed keys — no migration needed), and per this issue's own premise, no
shipped UI has ever written them, so no real install has them set. `InboxSubmissionSync`'s existing
unit test is updated to match the new guard clause's data source.

`SiteSettings` gains one genuinely new top-level field — a plain user toggle, not a provisioned
resource, mirroring `webmentionReceivePaidPlanAcknowledged`'s shape:

```swift
/// Whether inbox capture's `/inbox` route should be live in the composed Worker (#764). Kept
/// separate from `provisionedWorkerResources` (resource existence) so "provisioned but paused"
/// and "never provisioned" are distinguishable — mirrors how `activeWorkerIDs` (routing) is kept
/// separate from `provisionedWorkerResources` for the `@dwk/workers` catalog. `nil`/`false` = off;
/// `provisionedWorkerResources`'s inbox fields are left populated when paused so re-enabling
/// reuses the same namespace instead of creating a new one.
public var inboxCaptureEnabled: Bool?
```

Add `case kv` to `TokenCapability` (`Sources/AnglesiteCore/TokenCapabilities.swift`):

```swift
/// Workers KV namespace management (list/create).
case kv
```

and a probe entry in `CloudflareCapabilityProber.probe(token:zoneID:)`
(`Sources/AnglesiteCore/CloudflareCapabilityProber.swift`), in the account-scoped probe list
alongside `.workers`/`.turnstile`/`.registrar`:

```swift
(.kv, "accounts/\(accountID)/storage/kv/namespaces?per_page=1"),
```

`TokenCapability`/`CloudflareCapabilityProber` exist today but have no production consumer; this
is their first.

## Settings UI

New `SettingsBox("Inbox Capture")` inside the existing Workers tab
(`Sources/AnglesiteApp/PlistEditorView.swift`'s `workersTab`), placed alongside the other
composed-Worker feature rows. Contents:

- A `Toggle` bound through an async action (mirroring the existing per-worker row toggle at
  `PlistEditorView.swift:730-734`, `Task { await model.setInboxCaptureEnabled(newValue) }`).
- A status line driven by current settings state (`inboxCaptureEnabled`,
  `provisionedWorkerResources?.inboxKVNamespaceID`):
  - Off, never provisioned: "Not enabled."
  - On, not yet provisioned (namespace id nil): "Will activate on next deploy."
  - On, provisioned (namespace id set): "Active — namespace `<id>`."
  - Off, still provisioned (namespace id set): "Paused — submissions namespace kept, not
    receiving new ones."
- An error row on capability-check failure, matching the existing `workersError` treatment:
  `Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)`.

## Toggle behavior (`PlistEditorModel`)

New method `setInboxCaptureEnabled(_ enabled: Bool) async`, modeled on the existing
`setWorkerActive(_:isOn:)` (immediate read-modify-write of `settings.plist`, not deferred to
deploy time):

- **Turning on:** read the stored Cloudflare token (`SecretStore.readCloudflareToken()`) → if
  absent, surface the existing "connect a Cloudflare token first" state (same as other
  token-gated actions in this tab) and leave the toggle off. Otherwise
  `CloudflareCapabilityProber().probe(token:zoneID: nil)` → if the result lacks `.kv`, set
  `model.inboxCaptureError` to a friendly message ("Your Cloudflare token can't manage KV
  namespaces — recreate it from Settings ▸ Tokens.") and leave the toggle off — no
  `settings.plist` write. If `.kv` is present, write `inboxCaptureEnabled = true` immediately and
  clear any prior error. No `wrangler` call happens here — namespace creation is deferred to
  deploy time (below).
- **Turning off:** immediate write `inboxCaptureEnabled = false`.
  `provisionedWorkerResources.inboxKVNamespaceID`/`.inboxAccountID` are left untouched.

This mirrors the existing precedent that toggling a worker's active state is cheap and local,
while the actual Cloudflare resource lifecycle happens during `SocialWorkerProvisionCommand`'s
deploy-time run — no new wrangler-runner/container-exec path is added to the Settings/App layer.

## Deploy-time provisioning (`SocialWorkerProvisionCommand`)

`provision()` gains one new input parameter, mirroring `acknowledgesPaidPlan`'s existing shape
exactly (a plain flag `DeployModel` derives from settings and passes in — default `false` so every
other caller/test is unaffected):

```swift
inboxCaptureEnabled: Bool = false
```

`resources.inboxKVNamespaceID`/`.inboxAccountID` arrive for free through the existing
`knownResources` parameter — no new plumbing needed there, since they now live on
`ProvisionedResources`.

New block inside `provision()`, parallel to the existing D1/KV/R2 blocks (~line 230-275),
resuming from `resources.inboxKVNamespaceID` when already set:

```swift
if inboxCaptureEnabled, resources.inboxKVNamespaceID == nil {
    let name = "\(siteName)-inbox"
    let result = await runWrangler(
        siteDirectory: siteDirectory,
        arguments: ["kv", "namespace", "create", name, "--json"],
        environment: environment, source: source, resources: resources
    )
    let output: String
    switch result {
    case .success(let value): output = value
    case .failure(let failure): return failure
    }
    guard let id = Self.extractResourceID(from: output) else {
        return .failed(reason: "wrangler created KV namespace \(name) but no namespace id was found", exitCode: 0, resources: resources)
    }
    resources.inboxKVNamespaceID = id
    resources.inboxAccountID = await accountIDSource(token)
    if let failure = persistConfig(
        siteDirectory: siteDirectory, siteName: siteName, workers: workers,
        routeClaims: routeClaims, resources: resources, siteURL: siteURL,
        displayName: displayName, inboxCaptureEnabled: inboxCaptureEnabled
    ) {
        return failure
    }
}
```

`SocialWorkerProvisionCommand` has no existing raw-HTTP/Cloudflare-API seam of its own — its only
Cloudflare-API-touching capability today is the injected `workerScriptNamesSource` closure
(sourced from `DeployCommand`/`HTTPCloudflareClient` externally). Account-id resolution follows the
same shape: a new injected closure,

```swift
public typealias AccountIDSource = @Sendable (_ apiToken: String) async -> String?
```

added as an `init` parameter alongside `workerScriptNamesSource`, defaulting to a production
closure that calls a new public `HTTPCloudflareClient.accountID(apiToken:) async throws -> String`
— a thin public wrapper around that type's existing private `resolveAccountID(apiToken:)`. Tests
inject a fake returning a fixed id, same as every other seam on this command.

`persistConfig` (`SocialWorkerProvisionCommand.swift:534-…`) gains one new parameter,
`inboxCaptureEnabled: Bool`, threaded into `WorkerComposition.generateWranglerToml`'s existing
`inboxCaptureEnabled:` parameter; `inboxKVNamespaceID:` is sourced from `resources.inboxKVNamespaceID`
directly, since `resources` is already one of `persistConfig`'s parameters. This replaces the
current unconditional `false`/`nil` defaults and removes the code comment at
`SocialWorkerProvisionCommand.swift:544-548` flagging this exact gap. Every `persistConfig` call
site within one `provision()` run passes the same `inboxCaptureEnabled` value (a fixed input for
that run), so an earlier block's partial-failure retry never regresses a binding already written
by a later block or vice versa.

`DeployModel.swift`'s existing call (`socialCommand.provision(...)`, ~line 719) adds one argument:

```swift
inboxCaptureEnabled: settings.inboxCaptureEnabled ?? false
```

No other change is needed there — `knownResources: settings.provisionedWorkerResources ?? .init()`
already carries the inbox fields in, and the existing post-`.succeeded` call to
`DeployCoordinator.persistProvisionedResources(resources:)` already writes them back out to
`SiteSettings.provisionedWorkerResources` wholesale.

Known limitation, accepted as out of scope: `Self.readPersistedResources(from:)` (the wrangler.toml
scrape used when `knownResources == .init()`, e.g. after a fresh app install pointed at a site
already deployed by another machine) does not learn to recover `inboxKVNamespaceID` from an
existing `[[kv_namespaces]]` block — only `SiteSettings.provisionedWorkerResources` is treated as
authoritative for it. `inboxAccountID` is never recoverable from `wrangler.toml` at all (it's never
written there). A site's inbox capture would re-provision (create a second namespace) in that
narrow cross-machine scenario; the existing SOCIAL_KV/D1/R2 resources have the same gap today, so
this isn't a regression.

## De-provisioning

Toggling off (Settings, instant) + the next deploy regenerates `wrangler.toml` with
`inboxCaptureEnabled: false`: `generateWranglerToml` stops emitting the `/inbox` route claim,
`run_worker_first` entry, and `INBOX_KV` binding. The live Worker's `handleInbox` reverts to its
existing "unbound" behavior (`500 "Inbox capture not configured"`) rather than disappearing
outright — consistent with the route always being present in `worker.ts`'s `ROUTES` table. The KV
namespace and every staged/synced submission in it are untouched;
`provisionedWorkerResources.inboxKVNamespaceID` stays populated so re-enabling reuses the same
namespace (the `resources.inboxKVNamespaceID == nil` guard skips re-creation) instead of orphaning
the old one.

## Non-goals / explicitly deferred

- Manual "paste an existing namespace ID" path — provisioning always creates a fresh namespace via
  `wrangler kv namespace create`, matching the `SOCIAL_KV` precedent exactly.
- Immediate (non-deploy-deferred) provisioning. A toggle + "will activate on next deploy" status
  matches how every other composed-Worker feature in this tab already behaves, and avoids a second
  wrangler-invocation path outside `SocialWorkerProvisionCommand`.
- Actually deleting the KV namespace or its contents from any UI. The issue explicitly asks for
  de-provisioning to *not* delete captured data; namespace deletion (if ever wanted) is a separate,
  clearly-destructive action out of scope here.
- Teaching `readPersistedResources`'s wrangler.toml scraper to recover the inbox namespace id (see
  "Known limitation" above) — narrow cross-machine edge case, pre-existing gap shared with other
  resource types.
- A general shared `resolveAccountID` utility replacing the three already-duplicated private
  copies (`HTTPCloudflareClient`, `MicropubContentSync`, `ReceivedInteractionSync`). This design
  adds a fourth call path (via the new `AccountIDSource` closure's default) rather than
  consolidating the existing ones — that consolidation is a drive-by refactor of unrelated code,
  out of scope here.

## Testing

Follows the existing black-box seam-injection pattern (`SocialWorkerProvisionCommand`'s injectable
`CommandRunner`/`TokenSource`/`AccountIDSource`, `CloudflareCapabilityProber`'s injectable
`transport`) — no real network or wrangler calls in tests.

- `Tests/AnglesiteCoreTests/SiteConfigStoreTests.swift` — `inboxCaptureEnabled` and
  `ProvisionedResources.inboxKVNamespaceID`/`.inboxAccountID` round-trip through plist
  encode/decode; decoding a settings file written before these fields existed defaults them to
  `nil` without failing; decoding a settings file with the now-removed top-level
  `inboxCaptureAccountID`/`inboxCaptureKVNamespaceID` keys ignores them harmlessly.
- `Tests/AnglesiteCoreTests/InboxSubmissionSyncTests.swift` — updated guard-clause test now reads
  ids from `provisionedWorkerResources` instead of the removed top-level fields.
- `Tests/AnglesiteCoreTests/TokenCapabilitiesTests.swift` / `CloudflareCapabilityProberTests.swift`
  — new `.kv` case + probe path, both present (200) and absent (401/403) against a faked
  transport.
- `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift` — new incremental-provisioning
  block: fresh provision creates the namespace + resolves the account id + persists both via
  `persistConfig`; a partial failure (wrangler succeeds, id extraction fails) returns `.failed`
  without corrupting `resources`; a re-run with `resources.inboxKVNamespaceID` already set skips
  namespace creation and the injected `AccountIDSource`; `inboxCaptureEnabled: false` never invokes
  `wrangler kv namespace create`.
- `Tests/AnglesiteCoreTests/HTTPCloudflareClientTests.swift` — new public `accountID(apiToken:)`
  method against a faked transport.
- `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift` — extend existing
  `inboxCaptureEnabled`/`inboxKVNamespaceID` coverage (already implemented) to also exercise it via
  `persistConfig`'s new parameter, not just direct `generateWranglerToml` calls.
- `Tests/AnglesiteAppTests/PlistEditorModelTests.swift` — `setInboxCaptureEnabled(true)` with a
  `.kv`-capable token writes the setting; with a `.kv`-incapable token, leaves it unset and
  surfaces the friendly error; `setInboxCaptureEnabled(false)` never touches
  `provisionedWorkerResources`.
- Manual QA (hosted-app-only, per this repo's CI limitations for `DeployModel`/container-backed
  runs): toggle on with a real Cloudflare token, deploy, `curl -X POST .../inbox` against the live
  Worker and confirm a 202 + a staged key in the namespace; toggle off, redeploy, confirm the same
  request now 500s again while the previously staged key is still present in the namespace via the
  Cloudflare dashboard.
