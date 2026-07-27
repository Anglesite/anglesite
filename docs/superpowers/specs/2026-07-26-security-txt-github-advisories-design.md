# `security.txt` → GitHub security advisories — design (#843)

- **Date:** 2026-07-26
- **Status:** Proposed
- **Issue:** [#843 — `.well-known/security.txt` should point to GitHub if configured](https://github.com/Anglesite/Anglesite-app/issues/843)
- **Related:** [#405 — `security.txt`](https://github.com/Anglesite/Anglesite-app/issues/405), [#690 / `.well-known` support](2026-07-14-well-known-support-design.md), [#743 — state-aware `security.txt` check](https://github.com/Anglesite/Anglesite-app/issues/743), [#654 — Publish to GitHub](https://github.com/Anglesite/Anglesite-app/issues/654)

## Decision

A site whose `Source/` repo has a GitHub `origin` can route vulnerability reports to that repo's
**private advisory form** instead of only to an email address. Anglesite makes the offer, verifies
that the form would actually work for an outside reporter, and can enable the repo setting that
makes it work — but never rewrites the published contact without the owner asking for it.

Three things change:

1. `SECURITY_CONTACT` becomes an **ordered, comma-separated list**, so `security.txt` can publish
   more than one `Contact:` line in RFC 9116 preference order.
2. A new **Security Reports** tab in Website Settings owns the contact list, the lifecycle mode,
   and the GitHub offer.
3. A build-free **audit runner** emits a non-blocking `.info` finding when a site has a GitHub
   origin and isn't using its advisory form, pointing at that tab.

### Scope

This design covers only the **outbound** half of #843 — what Anglesite publishes in `security.txt`.

The issue's second half ("read this on open of an `.anglesite` package and offer to address issues
when possible or forward the information to `Anglesite/anglesite-app` if upstream") is an inbound
triage-inbox feature: GitHub API polling, an in-app report surface, remediation, and upstream
forwarding. It is deliberately **out of scope** and is tracked as
[#975](https://github.com/Anglesite/Anglesite-app/issues/975). Nothing in this design forecloses
it; `RemoteRepo`, `SecurityReportingReadiness`, and the `RepoSecurityReading` seam below are what
it builds on.

Also explicitly out of scope: RFC 9116's `Policy:`, `Preferred-Languages:`, `Encryption:`, and
`Acknowledgments:` fields. The [`.well-known` design](2026-07-14-well-known-support-design.md)
already classifies those as product enhancements rather than conformance defects, and adding them
here would widen the Settings surface without serving #843's ask.

## Background

`Resources/Template/scripts/edge-artifacts.ts` generates `public/.well-known/security.txt` at
prebuild from `.site-config`:

- `SECURITY_TXT_MODE` (`generated` | `manual` | `disabled`) selects the lifecycle. When unset it is
  inferred from whether `SECURITY_CONTACT` holds a usable contact, preserving pre-#743 behavior.
- `SECURITY_CONTACT` supplies exactly **one** contact. `normalizeSecurityContact` accepts an
  `https:`, `mailto:`, or `tel:` URI, promotes a bare email to `mailto:`, and rejects `http:`
  outright rather than publishing a spoofable plaintext channel.
- `buildSecurityTxt` emits the ownership marker, one `Contact:`, an `Expires:` 180 days out, and a
  `Canonical:` line when `SITE_URL` is a valid HTTPS URL.
- `scripts/pre-deploy-check.ts`'s `checkSecurityTxt` validates the **published** file against the
  resolved mode: it requires `Contact` count ≥ 1, exactly one non-expired `Expires`, at most one
  `Canonical`, and a final newline.

App-side there is nothing: no Swift type reads or writes `SECURITY_CONTACT`, and no UI exposes it.
An owner edits `.site-config` by hand or not at all. `MTAStsPolicyAsset` (#851) is the established
pattern for the missing piece — a pure `AnglesiteCore` type that parses and installs a feature's
`.site-config` keys, driven by a tab in `PlistEditorView`.

The GitHub side already exists too. `RemoteRepo.parse(remoteURL:)` turns a git remote into
`owner`/`name`/browse URL and **already rejects non-GitHub hosts**, so it is the whole host gate.
`InProcessGit.run(siteDirectory:arguments:)` answers `remote get-url origin` in-process.
`HTTPGitHubClient` talks to the REST API through an injectable transport, and
`GitHubAPITokenVerifier` establishes that the app's stored token is a fine-grained token with
`Contents: read/write` and `Administration: read/write`.

## The GitHub precondition

`https://github.com/<owner>/<name>/security/advisories/new` is only reachable by an outside
reporter when **both** hold:

- the repository is **public** — on a private repo the form is invisible to anyone without access,
  so publishing it as a `Contact:` would advertise a dead channel; and
- **private vulnerability reporting (PVR)** is **enabled** on the repository.

Both are readable, and PVR is writable, over the REST API (verified against the GitHub REST
documentation, API version `2022-11-28`):

| Purpose | Request | Response |
|---|---|---|
| Repo visibility | `GET /repos/{owner}/{repo}` | JSON with a `private` boolean |
| PVR state | `GET /repos/{owner}/{repo}/private-vulnerability-reporting` | JSON with a required `enabled` boolean |
| Enable PVR | `PUT /repos/{owner}/{repo}/private-vulnerability-reporting` | 204, no body |
| Disable PVR | `DELETE /repos/{owner}/{repo}/private-vulnerability-reporting` | 204, no body |

The write endpoints require **admin access to the repository**. The app's onboarding already asks
for a token with `Administration: read/write`, but a token can legitimately lack admin on a repo
the owner only contributes to. That case surfaces as a 403 and is reported as such — the UI names
the missing permission and links to the repo's settings page rather than failing silently or
retrying.

Anglesite never *disables* PVR. The `DELETE` endpoint is listed above for completeness only; the
app has no reason to turn off a reporting channel it didn't create, and doing so from a website
editor would be a surprising outward-facing side effect.

## Design

### 1. Template: an ordered contact list

`edge-artifacts.ts` gains one exported function and generalizes one existing one.

```ts
/**
 * Normalizes a comma-separated `SECURITY_CONTACT` into RFC 9116 Contact URIs, in the configured
 * preference order. Each entry goes through `normalizeSecurityContact`; unusable entries are
 * dropped and duplicates collapsed, mirroring `normalizeMTAStsMX`.
 */
export function normalizeSecurityContacts(raw: string | undefined): string[]

/** Now emits one `Contact:` line per normalized entry, in order. */
export function buildSecurityTxt(contacts: string | undefined, siteUrl: string | undefined, now: Date): string | null
```

`buildSecurityTxt` returns `null` when the list normalizes to empty, exactly as it returns `null`
for a single unusable contact today.

`resolveSecurityTxtMode` is **unchanged**, deliberately. It infers `generated` from a non-empty
raw string, not from a successfully-normalized one. Tightening it to "≥ 1 usable entry" would be
the more obvious reading, but it would silently reclassify a site whose contact is set-but-garbage
from `generated` to `disabled` — turning today's "SECURITY_CONTACT is unset or unusable" build note
and pre-deploy warning into silence, exactly when the owner most needs the signal. The looser rule
keeps the diagnostic.

Everything else in the generated file is unchanged: the `SECURITY_TXT_MARKER` first line (matched
byte-exact by `isSecurityTxtMarkerOwned` and by the pre-deploy check), the single `Expires:`, the
optional `Canonical:`, the ownership rules that refuse to overwrite a hand-authored file, and the
removal of a previously-generated file when the mode or contact goes away.

`checkSecurityTxt` in `pre-deploy-check.ts` needs **no change**: it already counts `Contact` lines
and only fails on zero, and its `Expires`/`Canonical` cardinality rules are untouched by this
work. Its "check `SECURITY_CONTACT` is set to a usable contact" remediation string stays accurate
for a list.

Comma-separation is the established house convention (`SCRIPT_ALLOW`, `MTA_STS_MX`), so this
design follows it — but a contact URI can legally contain a comma. RFC 3986 permits an unescaped
comma in a path or query (`https://example.com/report?ref=a,b`), and RFC 5321 permits one inside a
quoted local part (`"Doe, John"@example.com`). The single-value generator passed both through
byte-for-byte. Splitting unconditionally would silently truncate them, publishing a wrong
reporting address with no warning.

So the stored value is **escaped**: a comma inside one contact is written `%2C`, and each entry is
unescaped after the split.

**Only `%2C` is special.** The escape is a single targeted substitution, not a general
percent-decode — decoding arbitrary percent sequences would turn an ordinary `%20` in a URL into a
space and corrupt every contact written before this escaping existed. The residual case is a
contact that deliberately carries a literal `%2C` meaning an already-encoded comma; that decodes
to a raw comma. It is a vanishing case, and unlike truncation it neither drops nor shortens
anything.

**Migration: none.** Existing single values contain no `%2C` and no comma, so they round-trip
byte-identically.

### 2. `SecurityReportingAsset` (AnglesiteCore)

A new pure type modeled directly on `MTAStsPolicyAsset` — no I/O beyond the site's `.site-config`,
so it is fully testable on Linux and in CI.

```swift
public enum SecurityReportingAsset {
    public enum Mode: String, Sendable, CaseIterable, Identifiable { case generated, manual, disabled }

    public struct Settings: Sendable, Equatable {
        /// Preference-ordered contacts; one per line in the UI, comma-joined in `.site-config`.
        public var contacts: String
        public var mode: Mode
    }

    public static func parseSettings(from config: String) -> Settings
    public static func install(_ settings: Settings, siteDirectory: URL) throws

    /// The repo's private advisory form. `RemoteRepo` is GitHub-only by construction
    /// (`RemoteRepo.parse` rejects other hosts), so this needs no host check of its own.
    public static func advisoryURL(for repo: RemoteRepo) -> URL

    /// True when `contacts` already lists this repo's advisory form.
    public static func usesAdvisoryForm(_ contacts: String, repo: RemoteRepo) -> Bool

    /// Returns `contacts` with the advisory form prepended, preserving the rest in order and
    /// never duplicating an entry that is already present.
    public static func prependingAdvisoryForm(_ contacts: String, repo: RemoteRepo) -> String
}
```

`install` follows the house pattern: read the whole `.site-config`, `SiteConfigFile.upsert` the
`SECURITY_CONTACT` and `SECURITY_TXT_MODE` keys, write back only when the contents actually
changed.

Mirroring the template, the Swift side normalizes on save: entries are trimmed, blank lines
dropped, duplicates collapsed. It does **not** re-implement the template's URI validation — the
generator remains the single authority on what is a usable RFC 9116 contact, and the UI reports an
unusable entry rather than silently rewriting it (see "Validation ownership" below).

The Swift side owns the **write** half of the comma escape described above: `install` replaces any
comma inside an entry with `%2C` before joining, and `parseSettings` restores it after splitting.
The two halves are a matched pair — the template decodes exactly what Swift encodes, and neither
performs a general percent-decode.

### 3. Readiness: reading and writing the GitHub state

`HTTPGitHubClient` gains three methods, each following the existing `createRepo` shape (bearer
token, `application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `GitHubRepoAPIError`
mapping):

```swift
public func repositoryIsPrivate(owner: String, name: String, token: String) async throws -> Bool
public func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool
public func setPrivateVulnerabilityReporting(owner: String, name: String, enabled: Bool, token: String) async throws
```

They sit behind a narrow protocol seam so the model layer can be tested without network, following
the `CloudflareReading`/`CloudflareWriting` split:

```swift
public protocol RepoSecurityReading: Sendable {
    func isPrivate(owner: String, name: String, token: String) async throws -> Bool
    func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool
}

public protocol RepoSecurityWriting: Sendable {
    func setPrivateVulnerabilityReporting(owner: String, name: String, enabled: Bool, token: String) async throws
}
```

The decision itself is a **pure function** over already-fetched facts, so every branch is testable
with no fakes at all:

```swift
public enum SecurityReportingReadiness: Sendable, Equatable {
    case unknown            // not yet checked, or a check failed before one ever succeeded
    case notGitHub          // no origin, or a non-GitHub origin
    case alreadyConfigured  // the advisory form is already a Contact
    case ready              // public + PVR on — offer to add it
    case needsPVR           // public but PVR off — offer to enable, then add
    case repoPrivate        // private repo — explain, offer nothing

    public static func evaluate(repo: RemoteRepo?, isPrivate: Bool, pvrEnabled: Bool, contacts: String) -> Self
}
```

`unknown` is the initial state and the resting state of a failed check. `evaluate` never returns
it — a caller assigns it when it cannot get far enough to call `evaluate` at all (no token, a
Keychain error, an unreachable API). It exists because the alternative default, `notGitHub`,
asserts something false: that the site has no GitHub remote, when the truth is that nobody has
looked yet. A failed check therefore keeps whatever was last determined, or stays `unknown` —
it never collapses to `notGitHub`.

Precedence for `evaluate`, in order: `notGitHub` → `alreadyConfigured` → `repoPrivate` →
`needsPVR` → `ready`.
`alreadyConfigured` outranks `repoPrivate` deliberately: if the owner has already published the
form and later makes the repo private, the tab should say the channel is configured and warn about
visibility, not offer to configure something that is already there.

### 4. Settings UI: the Security Reports tab

`PlistEditorView` gains a `SettingsTab.securityReports = "Security Reports"` case, alongside the
existing Website / Analytics / Redirects / Crawlers / Email Security tabs. The name deliberately
distinguishes it from "Email Security" (SPF/DKIM/DMARC/MTA-STS), which is about mail authentication
rather than vulnerability reporting.

The tab contains:

- **Contacts** — a multi-line field, one contact per line, following the `MTA_STS_MX` presentation
  (newline-separated in the UI, comma-separated on disk). Help text names the accepted forms and
  states that order is preference order.
- **Mode** — a `Picker` over `generated` / `manual` / `disabled`, with the same phrasing the
  pre-deploy findings use, so a mode/file contradiction reported at deploy time is fixable here.
- **GitHub callout** — a state-driven section rendered only when an `origin` exists:

| Readiness | Callout |
|---|---|
| `alreadyConfigured` | Confirmation that reports route to the repo's advisory form, with a link to it. Adds a visibility warning when the repo is private. |
| `ready` | "Route vulnerability reports to GitHub" + a button that prepends the advisory URL to the contact list. |
| `needsPVR` | Explains that the repo's private reporting is off, and a button that enables it and then prepends the URL. Confirmed before the write, since it changes a GitHub repo setting. |
| `repoPrivate` | Explains that the advisory form isn't reachable by outside reporters on a private repo. No action offered. |
| `notGitHub` | Nothing rendered. |

`PlistEditorModel` gains `securityReportingSettings` / `savedSecurityReportingSettings` /
`isSecurityReportingDirty` / `securityReportingError`, exactly paralleling the `mtaSts*` members,
plus a `securityReportingReadiness` computed after a `refreshRepoSecurityState()` call. Readiness
is refreshed when the tab is loaded and after a successful PVR enable — not on a timer.

The new pane registers in `PlistEditorModel.dirtyFacets`, the generic aggregation added in #741, so
unsaved-changes prompts and `saveAllDirty` pick it up without any per-pane branching.

Failures are surfaced, never swallowed: a 403 from the PVR write reads as a missing-admin-permission
message naming the repo's settings page; a `.network` error says the state couldn't be checked and
leaves the previous readiness rather than silently degrading to `notGitHub`.

The PVR enable is an outward-facing change to a GitHub repository, so it is confirmed explicitly
before the request, and its result — enabled, or the specific failure — is reported. It is never
performed as a side effect of saving the contact list.

### 5. Audit finding

A new `SecurityTxtAuditRunner: AuditRunner` with `category: .security`, added to
`AuditCommand.defaultRunners` (today: `A11yAuditRunner` alone).

It spawns nothing and needs no token. It reads `.site-config` from `siteDirectory` and asks for the
remote via `git remote get-url origin`, then emits at most one finding.

The git call reuses the existing `BackupCommand.GitRunner` typealias and `BackupCommand.defaultRunner`
rather than introducing a seam of its own. That matters for portability: `InProcessGit` is
`#if canImport(Darwin)`-gated because SwiftGit2 has no Linux platform, and `defaultRunner` already
carries the Darwin (in-process SwiftGit2) / non-Darwin (subprocess `git`) split. Injecting the
runner is also how the tests avoid needing a real repository.

The finding:

- **`.info` — "Vulnerability reports aren't routed to GitHub"** when `RemoteRepo.parse` yields a
  repo and `usesAdvisoryForm` is false. Remediation points at Website Settings ▸ Security Reports.

Keeping the runner **token-free and API-free** is deliberate: an audit shouldn't make authenticated
network calls to decide whether to show an informational hint, and the expensive verification
(visibility + PVR) belongs where the owner is actually acting. The consequence is that the finding
can fire for a repo that turns out to be private — the Settings tab then explains why the offer
isn't available. That is the right failure direction: a hint that resolves to "not applicable"
costs nothing, whereas a silent skip would hide the feature from exactly the owners it targets.

**Known cost.** `AuditCommand` always runs `npm run build` before any runner, so this finding rides
behind a build it does not need. Accepted rather than introducing a second audit surface for one
`.info` finding; the audit is user-invoked and already builds for the a11y runner.

## Validation ownership

The generator is the single authority on RFC 9116 contact validity. Two consequences:

- The Swift side does not duplicate `normalizeSecurityContact`'s URI rules. It normalizes
  *shape* (trim, drop blanks, dedupe) and leaves *validity* to the template.
- An entry the generator would reject (e.g. `http://example.com/report`) is not silently deleted on
  save. It is written through, and the resulting build/pre-deploy signal is what tells the owner.
  A future enhancement can preview validity inline; this design does not fork the rule.

The advisory URL Anglesite generates is always well-formed and always `https:`, so the offer path
never produces an entry the generator would drop.

## Testing

| Layer | Suite | Coverage |
|---|---|---|
| Template | `Resources/Template/scripts/edge-artifacts.test.ts` (`npx tsx --test`) | `normalizeSecurityContacts` — order preserved, invalid dropped, dupes collapsed, empty → `[]`; `buildSecurityTxt` — one `Contact:` per entry in order, single-value output byte-identical to the pre-change file, `null` on empty; `resolveSecurityTxtMode` inference over a list |
| Core | `Tests/AnglesiteCoreTests/SecurityReportingAssetTests.swift` (Swift Testing) | `parseSettings` round-trip, comma↔newline conversion, `install` idempotence (no write when unchanged), `advisoryURL`, `usesAdvisoryForm`, `prependingAdvisoryForm` (no duplicate, order preserved) |
| Core | `Tests/AnglesiteCoreTests/SecurityReportingReadinessTests.swift` | Every `evaluate` branch and the stated precedence, including already-configured-but-private |
| Core | `Tests/AnglesiteCoreTests/SecurityTxtAuditRunnerTests.swift` | Finding emitted for a GitHub origin without the form; no finding when already configured, when there's no origin, and when the origin is non-GitHub |
| Core | `Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift` (extend) | The three new calls over a stub transport: 200/204 success, `enabled` decoding, 403 → `.unauthorized`, transport throw → `.network` |
| App | `Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsTests.swift` | Dirty tracking, save normalization, readiness refresh over a fake reader, PVR-enable success and 403 messaging — mirroring `PlistEditorModelMTAStsTests` |

Per `CONTRIBUTING.md`, touching `Resources/Template/` means `swift test --package-path .` runs too,
not just the template's own tests — some Swift suites string-match template output. New
user-visible strings require the `Localizable.xcstrings` merge documented there.

## Risks and limitations

- **Token admin scope.** A stored token without admin on the site's repo cannot enable PVR. Handled
  as an explicit 403 message, not a retry.
- **State drift.** Readiness is a point-in-time read. An owner who flips repo visibility on
  github.com after configuring the contact will keep publishing an unreachable form until the tab
  is revisited. The `alreadyConfigured`-plus-private warning is the mitigation; continuous
  monitoring belongs to the inbound follow-up, not here.
- **Anglesite doesn't own the reporting channel.** Enabling PVR makes GitHub the destination for
  reports; Anglesite neither reads nor forwards them. That is precisely the follow-up issue's job,
  and the reason this design stops at publishing the address.
