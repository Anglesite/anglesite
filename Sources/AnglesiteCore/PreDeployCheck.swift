import Foundation

/// Runs the bundled plugin's pre-deploy scans against a site directory and
/// returns a structured outcome the app can render.
///
/// The four mandatory blockers (PII, exposed tokens, third-party scripts,
/// Keystatic admin routes) come from `template/scripts/pre-deploy-check.ts`
/// invoked with `--json`. The JSON contract is owned by the plugin — this
/// actor is just a typed shell around `JSONDecoder` and a script invocation.
///
/// `PreDeployCheck` is intentionally minimal: no Cloudflare token resolution,
/// no `npm run build`, no UI. Callers (today: `DeployCommand`) decide what to
/// do with the `Outcome`. The build step lands with the deploy-flow polish in
/// #22; this actor presumes `dist/` already exists and surfaces a `.error`
/// outcome when it does not.
public actor PreDeployCheck {
    /// The scan verdict. There is deliberately no "override" case and no force flag anywhere in
    /// this type: the pre-deploy gate is a non-LLM security check the app surfaces but cannot
    /// bypass, so a `blocked` outcome ends the deploy until the owner fixes the findings.
    public enum Outcome: Sendable, Equatable {
        /// The deploy may proceed. `warnings` are advisory findings to show the owner — they
        /// never block.
        case passed(warnings: [ScanWarning])
        /// The deploy must not happen: at least one mandatory blocker fired. Warnings ride
        /// along so the owner sees the full picture in one pass instead of fixing blockers
        /// only to meet new advisories.
        case blocked(failures: [ScanFailure], warnings: [ScanWarning])
        /// Script error — couldn't run the scan at all (missing tsx, missing
        /// dist/, malformed JSON, unsupported envelope version). Distinct from
        /// `.blocked` so callers can surface the right remediation.
        case error(reason: String)
    }

    /// One mandatory blocker from the scan. `Codable` because it decodes straight off the
    /// script's JSON envelope — the raw-string categories below are the wire contract.
    public struct ScanFailure: Sendable, Equatable, Codable {
        /// The blocker's wire code. Raw values match the strings the scan script emits, so
        /// renaming a Swift case is safe but changing a raw value breaks decoding.
        public enum Category: String, Sendable, Codable, CaseIterable {
            /// Something shaped like an email address in the built output (`mailto:` links and
            /// vendored-content exemptions are handled script-side before this fires).
            case piiEmail = "pii-email"
            /// Something shaped like a phone number in the built output.
            case piiPhone = "pii-phone"
            /// Something shaped like a US Social Security number in the built output.
            case piiSSN = "pii-ssn"
            /// A pattern matching a known secret/API-token format in the built output.
            case exposedToken = "exposed-token"
            /// A known third-party tracking script. The current template script emits these as
            /// warnings, but the failure code is kept decodable — an older or stricter site
            /// script may still report it at blocker severity.
            case thirdPartyScript = "third-party-script"
            /// A Keystatic admin route leaked into production output — publishing it would
            /// expose the site's editing UI to the public.
            case keystaticRoute = "keystatic-route"
            /// `dist/_headers` is missing, lacks a Content-Security-Policy, or carries a
            /// misconfigured one.
            case cspMisconfigured = "csp-misconfigured"
            /// Built output references embed media on a platform CDN instead of the snapshot
            /// copy under `public/embeds/`. See `checkEmbedMedia` in
            /// `Resources/Template/scripts/pre-deploy-check.ts` (#682).
            case embedMediaHotlink = "embed-media-hotlink"
            /// Two or more owners claim the same effective `/.well-known/` path (or an
            /// exact/prefix pair overlaps) — `WellKnownInventory.merge` (#744) computed this
            /// Swift-side before build, the same way `RouteCoverageScanner`'s `.orphanedRoute`
            /// is computed Swift-side rather than emitted by the TS scan script.
            case wellKnownCollision = "well-known-collision"
            /// `Source/anglesite.json` exists but doesn't parse, isn't a JSON object, or declares
            /// a schema version this build doesn't recognize (#1173) — a structural problem
            /// `Resources/Template/scripts/pre-deploy-check.ts`'s `checkAnglesiteConfig` computes
            /// network-free, distinct from the deploy-time declared-vs-live check
            /// (`DeployCommand.Result.domainConfigDrift`).
            case anglesiteConfigInvalid = "anglesite-config-invalid"
            /// Any category code this build doesn't recognize yet — decoding falls back here
            /// instead of throwing, so a future/typo'd category can't crash the whole scan (#742).
            case other = "other"

            /// Decodes any unrecognized code as ``other`` rather than throwing — the fallback
            /// that keeps a newer scan script from breaking an older app build (#742).
            public init(from decoder: Decoder) throws {
                let raw = try decoder.singleValueContainer().decode(String.self)
                self = Category(rawValue: raw) ?? .other
            }
        }
        /// Which blocker fired.
        public let category: Category
        /// The scan's human-readable finding, shown verbatim in the blocked-deploy sheet.
        public let message: String
        /// Repo-relative path of the file where the issue was found, when known.
        public let file: String?
        /// Extra context beyond `message` (a matched snippet, a policy value), when the scan
        /// provides one.
        public let detail: String?
        /// The scan's suggested fix, when it has one — shown to the owner because the app
        /// surfaces failures rather than resolving them silently.
        public let remediation: String?

        /// Memberwise initializer, used by tests and by Swift-side scanners (e.g.
        /// `WellKnownInventory`) that merge their own findings into the scan outcome.
        public init(
            category: Category,
            message: String,
            file: String? = nil,
            detail: String? = nil,
            remediation: String? = nil
        ) {
            self.category = category
            self.message = message
            self.file = file
            self.detail = detail
            self.remediation = remediation
        }
    }

    /// One advisory finding from the scan: worth showing the owner, never deploy-blocking.
    /// Structurally identical to ``ScanFailure`` but kept a separate type so severity can't be
    /// laundered — a warning can never be passed where a failure is required, or vice versa.
    public struct ScanWarning: Sendable, Equatable, Codable {
        /// The advisory's wire code. Raw values match the strings the scan script emits, so
        /// renaming a Swift case is safe but changing a raw value breaks decoding.
        public enum Category: String, Sendable, Codable, CaseIterable {
            /// A page lacks its social-preview (Open Graph) image. Reserved wire code — no
            /// scan produces it yet (a harmless forward declaration, per the scan-envelope
            /// design doc).
            case missingOgImage = "missing-og-image"
            /// The site's maintenance cadence has lapsed. Reserved wire code — no producer yet.
            case maintenanceOverdue = "maintenance-overdue"
            /// A critical-ranked SEO defect — still advisory: SEO never blocks a deploy.
            /// Reserved wire code — no producer yet.
            case seoCritical = "seo-critical"
            /// A lower-priority SEO improvement. Reserved wire code — no producer yet.
            case seoWarning = "seo-warning"
            /// A route published by the previous deploy is no longer published and has no
            /// `redirects.json` entry covering it. Computed by `RouteCoverageScanner`, not the
            /// JS-side scan script — merged into the `Outcome` by `DeployCommand.deploy`.
            case orphanedRoute = "orphaned-route"
            /// An insecure `http://` resource reference in HTML/CSS — mixed content a browser
            /// would block or a downgrade attacker could tamper with.
            case mixedContent = "mixed-content"
            /// An external script or stylesheet loaded without Subresource Integrity, so a
            /// compromised CDN could alter it undetected.
            case sriMissing = "sri-missing"
            /// A `target="_blank"` link missing `rel="noopener"`, leaving the opener window
            /// scriptable by the destination page.
            case externalLinkRel = "external-link-rel"
            /// An expected security artifact wasn't published — also the catch-all the script
            /// uses when `dist/` itself is missing and there's nothing to scan.
            case missingSecurityArtifact = "missing-security-artifact"
            /// A `security.txt` mode/file mismatch (e.g. `SECURITY_TXT_MODE=disabled` but the file
            /// was published) or RFC 9116 content defect (missing Contact, wrong Expires count,
            /// stale/malformed Expires, wrong-origin or insecure Canonical, no final newline).
            /// See `Resources/Template/scripts/pre-deploy-check.ts`'s `checkSecurityTxt` (#743).
            case securityTxtIssue = "security-txt-issue"
            /// An RFC 8461 MTA-STS configuration or generated-policy defect.
            case mtaStsIssue = "mta-sts-issue"
            /// A known third-party tracking script in the built output — the severity the
            /// current template script emits for tracking (its blocker-side twin,
            /// ``PreDeployCheck/ScanFailure/Category/thirdPartyScript``, is kept for
            /// compatibility).
            case thirdPartyScript = "third-party-script"
            /// A `/.well-known/` file `WellKnownInventory.scanUserStatic` (#744) excluded from
            /// the inventory — a symlink, a percent-encoded-looking name, an oversized file, or a
            /// path that resolves outside the scanned root. Advisory: the file is simply left out
            /// of the effective inventory, not itself a collision.
            case wellKnownArtifact = "well-known-artifact"
            /// Any category code this build doesn't recognize yet — decoding falls back here
            /// instead of throwing, so a future/typo'd category can't crash the whole scan (#742).
            case other = "other"

            /// Decodes any unrecognized code as ``other`` rather than throwing — the fallback
            /// that keeps a newer scan script from breaking an older app build (#742).
            public init(from decoder: Decoder) throws {
                let raw = try decoder.singleValueContainer().decode(String.self)
                self = Category(rawValue: raw) ?? .other
            }
        }
        /// Which advisory fired.
        public let category: Category
        /// The scan's human-readable finding, shown verbatim to the owner.
        public let message: String
        /// Repo-relative path of the file where the issue was found, when known.
        public let file: String?
        /// Extra context beyond `message` (a matched snippet, a policy value), when the scan
        /// provides one.
        public let detail: String?
        /// The scan's suggested fix, when it has one.
        public let remediation: String?

        /// Memberwise initializer, used by tests and by Swift-side scanners
        /// (`RouteCoverageScanner`, `WellKnownInventory`) that merge their own findings into
        /// the scan outcome.
        public init(
            category: Category,
            message: String,
            file: String? = nil,
            detail: String? = nil,
            remediation: String? = nil
        ) {
            self.category = category
            self.message = message
            self.file = file
            self.detail = detail
            self.remediation = remediation
        }
    }

    /// The versioned JSON envelope emitted by `pre-deploy-check.ts --json` (#742).
    struct ScanReport: Decodable {
        let version: Int
        let ok: Bool
        let failures: [ScanFailure]
        let warnings: [ScanWarning]
    }

    /// Checked before a full `ScanReport` decode so an unsupported future envelope version
    /// reports a specific remediation instead of a generic malformed-JSON error.
    private struct VersionProbe: Decodable { let version: Int }

    /// The single decoder for `pre-deploy-check.ts --json` output (#742). Both `check` below and
    /// `DeployCommand.parseScanReport` call this — neither re-declares its own JSON shape.
    /// Anglesite is pre-1.0, so there is no legacy bare-array fallback: anything that isn't the
    /// current versioned envelope is an explicit `.error`.
    public static func parse(output: String, exitCode: Int32?) -> Outcome {
        let data = Data(output.utf8)
        guard let probe = try? JSONDecoder().decode(VersionProbe.self, from: data) else {
            return .error(reason: decodeErrorReason(exitCode: exitCode))
        }
        guard probe.version == 1 else {
            return .error(reason: "pre-deploy scan emitted an unsupported envelope version (\(probe.version)) — run `/anglesite:update`")
        }
        guard let report = try? JSONDecoder().decode(ScanReport.self, from: data) else {
            return .error(reason: decodeErrorReason(exitCode: exitCode))
        }
        return report.ok
            ? .passed(warnings: report.warnings)
            : .blocked(failures: report.failures, warnings: report.warnings)
    }

    /// No parseable envelope at all — either fully malformed JSON, or well-formed JSON missing
    /// `version` (including the pre-#742 bare-array shape, which has no `version` key).
    private static func decodeErrorReason(exitCode: Int32?) -> String {
        let exit = exitCode ?? -1
        return exit == 0
            ? "pre-deploy scan emitted no JSON (exit 0) — is the site's scripts/pre-deploy-check.ts up to date?"
            : "pre-deploy scan failed (exit \(exit)) — run `npm run build` and try again, or run `/anglesite:update` if the script is outdated"
    }

    /// Spawns the scan script and returns its stdout + exit code. Tests inject
    /// a fake; the default invoker shells out to `npx tsx scripts/pre-deploy-check.ts --json`
    /// with `siteDirectory` as cwd.
    public typealias ScriptInvoker = @Sendable (_ siteDirectory: URL) async throws -> (stdout: String, exitCode: Int32)

    private let invoke: ScriptInvoker

    /// Creates the check with the given invoker. There is no default argument on purpose: how
    /// the script actually runs depends on the site's runtime (container-backed since host
    /// Node was retired, #70), so construction always states explicitly how it gets run.
    public init(invoke: @escaping ScriptInvoker) {
        self.invoke = invoke
    }

    /// Runs the scan for one site and maps the result to an ``Outcome``. An invoker throw
    /// becomes ``Outcome/error(reason:)`` rather than propagating — a scan that couldn't run
    /// must still block the deploy visibly, not vanish into a thrown error a caller might
    /// swallow.
    public func check(siteID: String, siteDirectory: URL) async -> Outcome {
        let result: (stdout: String, exitCode: Int32)
        do {
            result = try await invoke(siteDirectory)
        } catch {
            return .error(reason: "couldn't run pre-deploy scan: \(error)")
        }
        return Self.parse(output: result.stdout, exitCode: result.exitCode)
    }
}
