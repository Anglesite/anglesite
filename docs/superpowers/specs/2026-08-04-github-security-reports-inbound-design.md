# Inbound GitHub security reports — design (#975)

- **Date:** 2026-08-04
- **Status:** Proposed
- **Issue:** [#975 — surface GitHub security reports for a site in-app](https://github.com/Anglesite/Anglesite/issues/975)
- **Related:** [#843 — outbound `security.txt` → GitHub advisories](2026-07-26-security-txt-github-advisories-design.md) (prerequisite, merged), [#1108 — dependency-sync-offer sheet](2026-07-30-template-dependency-additions-design.md)

## Decision

A site whose `Source/` repo has a GitHub `origin` gets a non-blocking, in-app view of that repo's
**open security advisories** and **open Dependabot alerts** — the inbound half #843 split off. A
per-window model reads both on package open (background, best-effort) and on demand; a toolbar
badge appears only when there is something open; a new section in Website Settings ▸ Security
Reports lists the detail. A Dependabot alert that the app's existing dependency-sync machinery can
already fix routes into that flow instead of a new one; a security advisory that turns out to be
about Anglesite itself, not the owner's site, can be forwarded to `Anglesite/Anglesite`'s own
advisory form via clipboard + browser, never an automatic API call.

### Scope

In scope: reading and surfacing both report types, the toolbar badge, the Settings-tab detail view,
routing a fixable Dependabot alert into the existing dependency-update sheet, and the
forward-to-`Anglesite/Anglesite` action.

Out of scope: anything that writes back to *GitHub's* copy of a report (dismissing/resolving an
alert, closing an advisory) — this is a read/triage surface, not a moderation UI. Also out of scope:
changing what `SecurityTxtAuditRunner` (#843) does; it stays token-free and unrelated to this
feature.

## Background

The prerequisite this builds on (#843, merged) provides:

- `RemoteRepo.parse(remoteURL:)` — the origin → `owner`/`name`/browse-URL parse, GitHub-only by
  construction.
- `RepoSecurityReading` / `RepoSecurityWriting` (`Sources/AnglesiteCore/RepoSecurity.swift`) — the
  read/write split this design's new protocol follows.
- `HTTPGitHubClient` — the injectable-transport REST client this design extends.
- The onboarding token recipe in `GitHubAPITokenVerifier.swift`, currently asking for a
  fine-grained token scoped to **Contents: read/write** and **Administration: read/write**.

Separately, #1108 already gives the app a working "offer a dependency bump the bundled template
already knows about" pipeline:

- `DependencySyncChecker.check(...)` (`AnglesiteCore`) — 3-way diff between the site's
  `package.json`, its scaffold-time baseline, and the app's bundled template, run on every site
  open behind a cheap version-stamp fast path.
- `DependencySync.diff(...)` — the pure comparison producing `DependencySyncOffers` (`updates` +
  `additions`).
- `DependencyUpdateModel` (`AnglesiteApp`) — the sheet model `SiteWindowModel.loadAndStart()` already
  presents when `check` finds offers (`SiteWindowModel.swift:1763`).
- `DependencyVersionComparator.isNewer(_:than:)` — ordering-only comparison over a version-range's
  leading numeric components; the comparison this design reuses to decide whether an offered range
  already reaches an alert's patched version.

And `HealthModel` (`Sources/AnglesiteCore/HealthModel.swift`) is the shape this design's new model
copies: a `@MainActor @Observable` class owned directly on `SiteWindowModel`
(`var health = HealthModel(...)`), a cancel-then-restart `recheck`, a settled `lastCheckedAt`, and a
badge-state enum the view layer never has to interpret raw data to compute.

## Design

### 1. Reading: `RepoAdvisoryReading` (AnglesiteCore)

A new read-only protocol, next to `RepoSecurityReading` in shape and naming:

```swift
public protocol RepoAdvisoryReading: Sendable {
    /// `GET /repos/{owner}/{repo}/security-advisories`, filtered to `state == "triage" ||
    /// state == "published"`. `draft` is excluded — an unsubmitted advisory the owner is
    /// themselves drafting isn't an inbound report. `closed` is excluded by definition of "open".
    func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory]

    /// `GET /repos/{owner}/{repo}/dependabot/alerts?state=open`.
    func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert]
}
```

Two new value types, `Sendable`/`Equatable`, alongside the protocol:

```swift
public struct SecurityAdvisory: Sendable, Equatable, Identifiable {
    public let id: String              // ghsa_id
    public let summary: String
    public let severity: Severity      // critical | high | moderate | low | unknown
    public let htmlURL: URL
    public let publishedAt: Date?
}

public struct DependabotAlert: Sendable, Equatable, Identifiable {
    public let id: Int                 // alert number
    public let packageName: String
    public let ecosystem: String       // "npm", etc. — display only in this design
    public let severity: SecurityAdvisory.Severity
    public let patchedVersion: String? // nil when GitHub has no fix yet
    public let htmlURL: URL
}
```

`HTTPGitHubClient` gains an extension conforming to `RepoAdvisoryReading`, reusing the existing
private `repoRequest`/`send` helpers and the same `GitHubRepoAPIError` mapping `RepoSecurityReading`
already uses (401/403 → `.unauthorized`, other non-2xx → `.http`, transport throw → `.network`,
undecodable body → `.malformedResponse`). No new error cases.

**Token scope.** I confirmed against GitHub's REST documentation that a fine-grained PAT needs the
repository permissions **"Repository security advisories: Read"** and **"Dependabot alerts: Read"**
to call these two endpoints (classic tokens would need `repo`/`security_events`, but this app's
onboarding only ever recommends fine-grained tokens, so that path is not covered here). Both get
added to the recipe string in `GitHubAPITokenVerifier.swift` (currently naming Contents and
Administration) and to any Settings UI that echoes it, so a token created before this feature still
gets a clear "recreate your token with these two extra permissions" message rather than a bare 403.

### 2. `SecurityReportsModel` (AnglesiteCore)

A new `@MainActor @Observable` class, structurally a sibling of `HealthModel`:

```swift
@MainActor @Observable
public final class SecurityReportsModel {
    public enum BadgeState: Sendable, Equatable { case clean, warnings, failures }

    public private(set) var openAdvisories: [SecurityAdvisory] = []
    public private(set) var openAlerts: [DependabotAlert] = []
    public private(set) var lastCheckedAt: Date?
    public private(set) var isRunning = false
    public private(set) var lastError: String?

    private let reader: any RepoAdvisoryReading
    private var inFlight: Task<Void, Never>?

    public init(reader: any RepoAdvisoryReading = HTTPGitHubClient()) { self.reader = reader }

    /// Cancels any in-flight check and starts a new one. `repo == nil` (no GitHub origin) or
    /// `token == nil` (no stored token) both clear state to empty rather than erroring — neither
    /// is a failure, just nothing to show.
    @discardableResult
    public func recheck(repo: RemoteRepo?, token: String?) -> Task<Void, Never>

    /// `.failures` if any open item is critical/high severity, `.warnings` if any is open at
    /// moderate/low/unknown, `.clean` otherwise (including "never checked" — the badge view hides
    /// itself on `.clean` with a zero count rather than rendering a "you're fine" state).
    public var badgeState: BadgeState { get }

    public var totalCount: Int { openAdvisories.count + openAlerts.count }
}
```

Owned directly on `SiteWindowModel` (`var securityReports = SecurityReportsModel()`), alongside
`health`. Both the toolbar badge and the Settings-tab section read this one instance, so a check
kicked off from either place is visible in both without a second fetch.

### 3. Read timing

`SiteWindowModel.loadAndStart()` gets one more detection-hook call, next to the existing
`DependencySyncChecker.check(...)` call at `SiteWindowModel.swift:1763`: if the site resolves a
GitHub `RemoteRepo` and a stored token is available, fire `securityReports.recheck(repo:token:)` and
do not await it — the rest of `loadAndStart()` proceeds immediately. No token, no GitHub remote, or
a failed fetch all leave the badge simply absent; none of them block or delay site open. The same
`recheck` is exposed as a manual "Check for reports" action from both the badge popover and the
Settings-tab section, so timing is one code path with two triggers, per the earlier decision.

### 4. Toolbar badge

`SecurityReportsBadgeView` (`AnglesiteApp`), structurally a trimmed `HealthBadgeView`: same
`ScaledMetric` dot/glyph, same `differentiateWithoutColor` handling, same `.popover` pattern. Two
differences from `HealthBadgeView`:

- **Conditionally rendered.** `HealthBadgeView` is always in the toolbar because deploy-readiness
  always applies. This badge only appears when `securityReports.totalCount > 0` or
  `securityReports.isRunning` — a site with nothing open doesn't get a second always-on toolbar
  dot next to the health badge.
- **Its popover is a summary, not the full view.** It lists up to a handful of items (title +
  severity) and a "View all in Security Reports" button that opens Website Settings and switches to
  the Security Reports tab — that tab, not the popover, is the actual triage surface with per-item
  actions.

### 5. Settings UI: "Open reports" section

The existing Security Reports tab (`PlistEditorView`, #843) gains a new section below the current
outbound-configuration one, bound to the shared `SiteWindowModel.securityReports` model (passed
into `PlistEditorModel`'s init alongside the existing `repoSecurity` dependency) rather than to a
copy owned by `PlistEditorModel` itself — that keeps it in sync with the toolbar badge and avoids a
second fetch per sheet open.

Per-advisory row: severity, summary, "View on GitHub" (opens `htmlURL`), "Forward to Anglesite"
(§6). Per-alert row: package name + ecosystem, severity, and one action depending on §7's mapping —
"Update available" (opens the dependency-update sheet) or "View on GitHub" when no fix is known yet.
An empty state ("No open reports") renders when both lists are empty and a check has completed at
least once; "Not checked yet" plus the manual action when it hasn't.

### 6. Forward-to-upstream

`Anglesite/Anglesite` is the current canonical app repo (the issue's "Anglesite-app" predates the
rename — see the repo's own memory notes on this). A pure formatter builds a plain-text summary:

```swift
public enum AdvisoryForwarding {
    public static let anglesiteAdvisoryFormURL = URL(string: "https://github.com/Anglesite/Anglesite/security/advisories/new")!

    /// Plain text for the clipboard: advisory title, GHSA URL, and a note that it was found
    /// while triaging reports against `siteRepo`. No advisory *description* body is included —
    /// only what's already public in the GHSA metadata (title/URL) — the reporter pastes and
    /// edits in whatever additional detail they judge appropriate before submitting.
    public static func clipboardText(for advisory: SecurityAdvisory, siteRepo: RemoteRepo) -> String
}
```

"Forward to Anglesite" copies that text to the pasteboard and opens
`anglesiteAdvisoryFormURL` via `NSWorkspace.shared.open(_:)`. The owner pastes and submits it
themselves on github.com — this satisfies the "explicit permission for any outward publish" rule by
construction, since the app never transmits anything; it only prepares text and opens a page. This
also sidesteps the token-scoping dead end from the original "direct API call" idea: fine-grained
PATs cannot be scoped to a repository outside the token owner's own account/org (confirmed against
GitHub's PAT documentation), so an in-app API call would only work for `Anglesite`-org members —
clipboard + browser works for every user, using their own github.com session.

Deliberately **not included**: the advisory's private `description`/`vulnerabilities` fields. Only
the title and the GHSA's own public URL go on the clipboard; anything more specific is the owner's
call to add, which is exactly what "explicit permission, not silent forwarding" means here.

### 7. Dependabot alert → dependency-sync mapping

A new pure function on `DependencySync`:

```swift
extension DependencySync {
    /// `nil` when no fix is known (`alert.patchedVersion == nil`), the package isn't in the
    /// current sync offers, or the offered range doesn't yet reach the patched version.
    /// Otherwise the matching `DependencyUpdateOffer` — the same offer `DependencyUpdateModel`
    /// already knows how to present and apply.
    public static func fixOffer(for alert: DependabotAlert, in offers: DependencySyncOffers) -> DependencyUpdateOffer?
}
```

Implementation: look up `offers.updates.first(where: { $0.name == alert.packageName })`; if found
and `alert.patchedVersion` is non-nil, confirm the offer's `offeredRange` isn't older than
`patchedVersion` via `!DependencyVersionComparator.isNewer(patchedVersion, than: offeredRange)`
(i.e. the patched version is not newer than what the template already offers). `nil` on any
`DependencyVersionComparator` parse failure, per that type's existing "never guess" contract.

`SiteWindowModel` already computes `DependencySyncOffers` once per site-open for the existing
dependency-update sheet; the Settings-tab view reuses that same computed value (threaded through
alongside `securityReports`) rather than recomputing it, so an alert row's action is available as
soon as both checks have completed, with no duplicate `package.json` read.

Clicking "Update available" on an alert row opens the existing `DependencyUpdateModel` sheet
pre-filtered/scrolled to that one offer — no new apply logic, no new sheet type. If the owner
accepts, `DependencySyncApplier` runs exactly as it does today from the standalone sheet.

## Testing

| Layer | Suite | Coverage |
|---|---|---|
| Core | `Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift` (extend) | `openSecurityAdvisories`/`openDependabotAlerts` over a stub transport: state filtering (`triage`/`published` kept, `draft`/`closed` excluded; `state=open` alerts only), decoding of severity/patched-version/URL fields, 401/403 → `.unauthorized`, transport throw → `.network`, malformed body → `.malformedResponse` |
| Core | `Tests/AnglesiteCoreTests/SecurityReportsModelTests.swift` | `recheck` cancellation (mirrors `HealthModelTests`' pattern), `nil` repo/token both clear to empty without setting `lastError`, `badgeState` over all severity combinations, `lastCheckedAt` only set on a settled (not cancelled) run |
| Core | `Tests/AnglesiteCoreTests/DependencySyncFixOfferTests.swift` | `nil` on no patched version, package absent from offers, and offer-still-behind-patch; a match when the offer reaches or exceeds the patched version |
| Core | `Tests/AnglesiteCoreTests/AdvisoryForwardingTests.swift` | Clipboard text includes title + GHSA URL + site repo reference; never includes anything beyond those (regression guard against a future field accidentally pulling in advisory description text) |
| App | `Tests/AnglesiteAppTests/SecurityReportsBadgeVisibilityTests.swift` (or fold into an existing `SiteWindowModel` suite) | Badge hidden at zero count and not-yet-checked; visible once `recheck` settles with ≥1 item; state-to-color/glyph mapping |
| App | `Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsSectionTests.swift` | Row actions wire to the right target (browse URL, dependency sheet, forward action) for representative fixtures of each type |

No paired sidecar PR: this touches only `Anglesite/Anglesite` (Swift app code, no MCP message
schema change).

## Risks and limitations

- **Existing tokens are under-scoped.** Every token created before this feature lacks the two new
  read permissions, so the first background check after upgrade will 403 for most existing users.
  Handled as a named, actionable message (like the existing `Contents`/`Administration` case), not a
  silent failure — but it means most users see "recreate your token" before they see any actual
  report data, even on sites with nothing open.
- **Point-in-time reads, not a live feed.** Like #843's readiness check, this reflects the state at
  the last `recheck`, not a subscription. An advisory opened on github.com between checks is
  invisible until the next background-open or manual refresh.
- **Dependabot alert coverage is bounded by the bundled template.** `fixOffer` can only ever offer a
  fix the app's *current* bundled template already carries a patched-enough range for. An alert on a
  package the template doesn't track at all, or where even the template's newest known range is
  still vulnerable, always falls back to "View on GitHub" — this design does not add a general
  "bump to an arbitrary npm version" capability, only reuses the existing template-comparison one.
- **Forwarding is a courtesy action, not a disclosure workflow.** It opens a form and pre-fills a
  clipboard; it has no way to confirm the owner actually submitted anything, and no state ("forwarded
  already") is tracked. A second click "forwards" (opens the form) again with no memory of the first.
