import Foundation

/// Applies what `SecurityTxtMigrationChecker` found (design doc "Apply"). Three entry points:
/// `applyBackfill` for the two silently-appliable outcomes (no owner consent needed), and
/// `applyDecision` for the owner's (or a noninteractive caller's) Adopt/Preserve choice.
public enum SecurityTxtMigrationApplier {
    /// The owner's (or the noninteractive default's) answer to a `SecurityTxtMigrationPlan
    /// .needsDecision` — the only decision this mechanism ever delegates.
    public enum Decision: Sendable, Equatable {
        /// Adopt as generated: prepend the current marker so the next build's own generator
        /// treats this as its own output, and gitignore it as build output going forward.
        case adopt
        /// Preserve as hand-authored: leave file content untouched; ensure it's not gitignored,
        /// so it becomes normally git-trackable.
        case preserve
    }

    /// Writes only `SECURITY_TXT_MODE` (contacts are left exactly as they are — this never
    /// touches `SECURITY_CONTACT`). Returns `[".site-config"]` if the value changed, `[]` if it
    /// was already correct (idempotent re-run). Non-throwing; write failures are silently ignored
    /// so partial progress is always reported.
    public static func applyBackfill(
        mode: SecurityReportingAsset.Mode, sourceDirectory: URL
    ) -> [String] {
        writeMode(mode, sourceDirectory: sourceDirectory)
    }

    /// Applies the owner's (or the noninteractive default's) Adopt/Preserve decision for an
    /// unmarked legacy `security.txt` (design doc "Apply" step 2-5). Non-throwing; write failures
    /// are silently ignored so partial progress is always reported.
    public static func applyDecision(
        _ decision: Decision, sourceDirectory: URL
    ) -> [String] {
        var touched: [String] = []
        switch decision {
        case .adopt:
            touched += writeMode(.generated, sourceDirectory: sourceDirectory)
            let fileURL = sourceDirectory.appendingPathComponent("public/.well-known/security.txt")
            var fileExists = false
            if let existing = try? String(contentsOf: fileURL, encoding: .utf8) {
                // Only prepend the marker if it isn't already there — this branch is also reached
                // for an already-marker-owned file (`SecurityTxtMigrationChecker`'s `.silentAdopt`
                // for a file the current generator already owns), and prepending unconditionally
                // would duplicate the marker line on every such call.
                if !isMarkerOwned(existing) {
                    let marked = GeneratedEndpoints.securityTxtMarker + "\n" + existing
                    _ = try? marked.write(to: fileURL, atomically: true, encoding: .utf8)
                }
                fileExists = true
            }
            // The file itself is never added to `touched`: once adopted, it's build output the
            // next generator run owns (that's what `.gitignore` below encodes), so it never needs
            // to be part of the git commit — only `.site-config` and `.gitignore` do. Committing it
            // anyway would also stage a path this same call is gitignoring, which fails the whole
            // batch commit on the non-Darwin `git add` path.
            if fileExists {
                touched += updateGitignore(sourceDirectory: sourceDirectory, adopt: true)
            }
        case .preserve:
            touched += writeMode(.manual, sourceDirectory: sourceDirectory)
            touched += updateGitignore(sourceDirectory: sourceDirectory, adopt: false)
        }
        return touched
    }

    private static func writeMode(
        _ mode: SecurityReportingAsset.Mode, sourceDirectory: URL
    ) -> [String] {
        let configURL = sourceDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated = SiteConfigFile.upsert([("SECURITY_TXT_MODE", mode.rawValue)], into: config)
        guard updated != config else { return [] }
        if (try? updated.write(to: configURL, atomically: true, encoding: .utf8)) != nil {
            return [WebsiteAnalyticsAsset.configRelativePath]
        }
        return []
    }

    /// True when `content`'s first line is exactly the current generator's marker — mirrors
    /// `SecurityTxtMigrationChecker.isMarkerOwned` (and, on the TypeScript side,
    /// `isSecurityTxtMarkerOwned`).
    private static func isMarkerOwned(_ content: String) -> Bool {
        content.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first
            == GeneratedEndpoints.securityTxtMarker[...]
    }

    private static func updateGitignore(sourceDirectory: URL, adopt: Bool) -> [String] {
        let gitignoreURL = sourceDirectory.appendingPathComponent(".gitignore")
        let contents = (try? String(contentsOf: gitignoreURL, encoding: .utf8)) ?? ""
        let updated = adopt
            ? SecurityTxtGitignoreSync.addingIgnoreEntry(to: contents)
            : SecurityTxtGitignoreSync.removingIgnoreEntry(from: contents)
        guard updated != contents else { return [] }
        if (try? updated.write(to: gitignoreURL, atomically: true, encoding: .utf8)) != nil {
            return [".gitignore"]
        }
        return []
    }
}
