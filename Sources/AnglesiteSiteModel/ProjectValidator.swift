import Foundation

/// Decides whether a directory is an Anglesite site project.
///
/// The sentinel filenames must match what the scaffolder actually writes (see
/// `Resources/Template/` + `scaffold.sh`): the canonical markers are `.site-config` and
/// `astro.config.ts` (the template moved off `astro.config.mjs` in #380 — using the old `.mjs`
/// name here flagged every freshly scaffolded site as invalid). They are *not*
/// `anglesite.config.json`, which the template has never produced.
///
/// Two tiers of sentinels:
///   - **Required** (`requiredSentinels`) — must be present for the directory to count as an
///     Anglesite project at all: `.site-config` (identifies the project as Anglesite-managed and
///     is read by `scripts/config.ts`'s `readConfig`) and `astro.config.ts` (it's an Astro site).
///   - **Recommended** (`recommendedSentinels`) — optional integration markers that aren't
///     load-bearing for the core preview + edit pipeline. A site missing only recommended
///     sentinels is still valid; the UI can surface them as optional rather than blockers.
///     Currently empty (the template ships no optional-but-recommended marker), but the tier is
///     retained for future integrations.
///
/// `Result.isValid` checks required only. `Result.missing` reports everything missing (so the
/// UI can surface an otherwise-valid site's missing optional markers). `Result.missingRequired`
/// is the subset the UI uses to decide blocker vs. nice-to-have.
public enum ProjectValidator {
    /// Sentinels that must all be present for a directory to count as an Anglesite project
    /// (the "required" tier described above).
    public static let requiredSentinels: [String] = [
        ".site-config",
        "astro.config.ts"
    ]
    /// Optional integration markers (the "recommended" tier described above). Currently empty;
    /// the tier is retained so future integrations can surface nice-to-haves without becoming
    /// blockers.
    public static let recommendedSentinels: [String] = []
    /// Union of required + recommended — the full set a caller can check without caring about the
    /// tier split. No production code depends on it today (`SiteStore` validates via `validate`'s
    /// `Result`); it's retained as the tier-agnostic API surface and is exercised by the tests.
    /// While `recommendedSentinels` is empty this equals `requiredSentinels`.
    public static let sentinels: [String] = requiredSentinels + recommendedSentinels

    /// The outcome of validating one directory: which sentinels are missing, split by tier so
    /// the UI can distinguish blockers from nice-to-haves.
    public struct Result: Sendable, Equatable {
        /// The directory that was validated.
        public let directory: URL
        /// Every sentinel that's missing — required + recommended. Drives the sidebar caption.
        public let missing: [String]
        /// The subset of `missing` that's actually required. `isValid` is `missingRequired.isEmpty`.
        public let missingRequired: [String]

        /// `true` when every **required** sentinel is present — missing recommended sentinels
        /// don't invalidate a project.
        public var isValid: Bool { missingRequired.isEmpty }

        /// Memberwise initializer, public so tests and previews can construct fixture results;
        /// production code gets a `Result` from ``ProjectValidator/validate(_:fileManager:)``.
        public init(directory: URL, missing: [String], missingRequired: [String]) {
            self.directory = directory
            self.missing = missing
            self.missingRequired = missingRequired
        }
    }

    /// Inspects `directory` and returns which sentinel files (if any) are missing.
    public static func validate(_ directory: URL, fileManager: FileManager = .default) -> Result {
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: directory.path, isDirectory: &isDir), isDir.boolValue else {
            return Result(directory: directory, missing: sentinels, missingRequired: requiredSentinels)
        }
        let missing = sentinels.filter { name in
            !fileManager.fileExists(atPath: directory.appendingPathComponent(name).path)
        }
        let missingRequired = missing.filter { requiredSentinels.contains($0) }
        return Result(directory: directory, missing: missing, missingRequired: missingRequired)
    }
}
