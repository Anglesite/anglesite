import Foundation

/// One `SecurityTxtMigrationChecker.check` outcome (design doc "Detection: security.txt").
public enum SecurityTxtMigrationPlan: Sendable, Equatable {
    /// `SECURITY_TXT_MODE` is already set in `.site-config` — nothing to migrate. The key's own
    /// presence is this mechanism's idempotency marker (design doc "Data model").
    case nothingToDo
    /// No file exists — the mode is inferred from whether a contact is configured, matching
    /// `resolveSecurityTxtMode`'s existing behavior. Mode-only write, no file to touch.
    case silentBackfillMode(SecurityReportingAsset.Mode)
    /// The file is already marker-owned (mode-only backfill to `.generated`), **or** it's
    /// unmarked but positively matches what the pre-#743 generator would have produced from the
    /// site's current settings — in both cases the app can resolve this on its own, the same way
    /// an unmodified `scripts/` file silently refreshes (Task 3). Apply via
    /// `SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory:)`.
    case silentAdopt
    /// An unmarked `security.txt` exists and does **not** match the old generator's shape — a
    /// genuine ambiguity needing an Adopt/Preserve decision, interactively, or defaulted to
    /// Preserve in a noninteractive flow (design doc "Noninteractive flows").
    case needsDecision
}

/// Detects whether a site's `SECURITY_TXT_MODE` needs backfilling and, if an unmarked
/// `public/.well-known/security.txt` exists, whether it can be positively classified as
/// Anglesite's own historical output (design doc "Detection: security.txt"). Pure; makes no
/// writes — only `SecurityTxtMigrationApplier` does that.
public enum SecurityTxtMigrationChecker {
    public static func check(sourceDirectory: URL) -> SecurityTxtMigrationPlan {
        let configURL = sourceDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "SECURITY_TXT_MODE", in: config) == nil else {
            return .nothingToDo
        }

        let rawContact = SiteConfigFile.value(forKey: "SECURITY_CONTACT", in: config)
        let siteURL = SiteConfigFile.value(forKey: "SITE_URL", in: config)
        let fileURL = sourceDirectory.appendingPathComponent("public/.well-known/security.txt")
        guard let existingContent = try? String(contentsOf: fileURL, encoding: .utf8) else {
            // No file, no contact: nothing to migrate, and `SECURITY_TXT_MODE` is left unset
            // rather than pinned to `.disabled` — an explicit mode always wins over
            // `resolveSecurityTxtMode`'s inference from `SECURITY_CONTACT` on the TS side, so
            // backfilling `.disabled` here would permanently defeat that inference even after the
            // owner later hand-adds a contact to `.site-config` (a normal, supported workflow).
            // No file, WITH a contact configured: still unambiguous and safe to backfill silently,
            // matching `resolveSecurityTxtMode`'s existing inference — nothing here for an owner to
            // lose.
            let hasContact = !(rawContact ?? "").trimmingCharacters(in: .whitespaces).isEmpty
            guard hasContact else { return .nothingToDo }
            return .silentBackfillMode(.generated)
        }

        if isMarkerOwned(existingContent) {
            return .silentAdopt
        }

        let classification = SecurityTxtLegacyClassifier.classify(
            existingContent: existingContent, rawContact: rawContact, siteURL: siteURL
        )
        return classification == .matchesLegacyShape ? .silentAdopt : .needsDecision
    }

    /// True when `content`'s first line is exactly the current generator's marker — mirrors
    /// `isSecurityTxtMarkerOwned` on the TypeScript side.
    private static func isMarkerOwned(_ content: String) -> Bool {
        content.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first
            == GeneratedEndpoints.securityTxtMarker[...]
    }
}
