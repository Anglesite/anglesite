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
    public enum Outcome: Sendable, Equatable {
        case passed(warnings: [ScanWarning])
        case blocked(failures: [ScanFailure], warnings: [ScanWarning])
        /// Script error — couldn't run the scan at all (missing tsx, missing
        /// dist/, malformed JSON, unsupported envelope version). Distinct from
        /// `.blocked` so callers can surface the right remediation.
        case error(reason: String)
    }

    public struct ScanFailure: Sendable, Equatable, Codable {
        public enum Category: String, Sendable, Codable, CaseIterable {
            case piiEmail = "pii-email"
            case piiPhone = "pii-phone"
            case piiSSN = "pii-ssn"
            case exposedToken = "exposed-token"
            case thirdPartyScript = "third-party-script"
            case keystaticRoute = "keystatic-route"
            case cspMisconfigured = "csp-misconfigured"
            /// Two or more owners claim the same effective `/.well-known/` path (or an
            /// exact/prefix pair overlaps) — `WellKnownInventory.merge` (#744) computed this
            /// Swift-side before build, the same way `RouteCoverageScanner`'s `.orphanedRoute`
            /// is computed Swift-side rather than emitted by the TS scan script.
            case wellKnownCollision = "well-known-collision"
            /// Any category code this build doesn't recognize yet — decoding falls back here
            /// instead of throwing, so a future/typo'd category can't crash the whole scan (#742).
            case other = "other"

            public init(from decoder: Decoder) throws {
                let raw = try decoder.singleValueContainer().decode(String.self)
                self = Category(rawValue: raw) ?? .other
            }
        }
        public let category: Category
        public let message: String
        /// Repo-relative path of the file where the issue was found, when known.
        public let file: String?
        public let detail: String?
        public let remediation: String?

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

    public struct ScanWarning: Sendable, Equatable, Codable {
        public enum Category: String, Sendable, Codable, CaseIterable {
            case missingOgImage = "missing-og-image"
            case maintenanceOverdue = "maintenance-overdue"
            case seoCritical = "seo-critical"
            case seoWarning = "seo-warning"
            /// A route published by the previous deploy is no longer published and has no
            /// `redirects.json` entry covering it. Computed by `RouteCoverageScanner`, not the
            /// JS-side scan script — merged into the `Outcome` by `DeployCommand.deploy`.
            case orphanedRoute = "orphaned-route"
            case mixedContent = "mixed-content"
            case sriMissing = "sri-missing"
            case externalLinkRel = "external-link-rel"
            case missingSecurityArtifact = "missing-security-artifact"
            /// A `security.txt` mode/file mismatch (e.g. `SECURITY_TXT_MODE=disabled` but the file
            /// was published) or RFC 9116 content defect (missing Contact, wrong Expires count,
            /// stale/malformed Expires, wrong-origin or insecure Canonical, no final newline).
            /// See `Resources/Template/scripts/pre-deploy-check.ts`'s `checkSecurityTxt` (#743).
            case securityTxtIssue = "security-txt-issue"
            /// An RFC 8461 MTA-STS configuration or generated-policy defect.
            case mtaStsIssue = "mta-sts-issue"
            case thirdPartyScript = "third-party-script"
            /// A `/.well-known/` file `WellKnownInventory.scanUserStatic` (#744) excluded from
            /// the inventory — a symlink, a percent-encoded-looking name, an oversized file, or a
            /// path that resolves outside the scanned root. Advisory: the file is simply left out
            /// of the effective inventory, not itself a collision.
            case wellKnownArtifact = "well-known-artifact"
            /// Any category code this build doesn't recognize yet — decoding falls back here
            /// instead of throwing, so a future/typo'd category can't crash the whole scan (#742).
            case other = "other"

            public init(from decoder: Decoder) throws {
                let raw = try decoder.singleValueContainer().decode(String.self)
                self = Category(rawValue: raw) ?? .other
            }
        }
        public let category: Category
        public let message: String
        public let file: String?
        public let detail: String?
        public let remediation: String?

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

    public init(invoke: @escaping ScriptInvoker) {
        self.invoke = invoke
    }

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
