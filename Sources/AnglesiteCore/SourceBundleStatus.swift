import Foundation

/// "Code changes not yet deployed" (#799, spec §C.4 error-handling section): compares the git
/// commit SHA recorded at the last successful deployed-source bundle upload
/// (`SiteSettings.deployedSourceBundleCommit`) against `Source/`'s current `HEAD`. Surfaced as
/// existing dirty-state UI (`DeployDrawerView`), never as a bake error — a stale bundle is
/// correct-but-stale by design, not a failure.
public enum SourceBundleStatus: Sendable, Equatable {
    /// `.site-config` has no `CF_SOURCE_BUCKET` — the deployed-source bundle feature isn't active
    /// for this site (today: every site, since no provisioning flow writes that key yet).
    case notConfigured
    /// A bucket is configured but no upload has ever succeeded (`deployedSourceBundleCommit` is
    /// `nil`).
    case notYetUploaded
    /// The last uploaded commit matches `Source/`'s current `HEAD` — nothing to surface.
    case upToDate
    /// `Source/` has commits after the last uploaded bundle.
    case dirty(uploadedCommit: String, currentCommit: String)

    /// Computes the status for one site by reading `.site-config` and asking git for `HEAD`.
    /// Deliberately quiet on every failure path: an unreadable config or a `rev-parse` that
    /// doesn't run reports `.notConfigured`/`.upToDate` rather than an error — this check only
    /// exists to *offer* a "redeploy your source bundle" nudge, so a wrong-but-calm answer beats
    /// alarming the owner over a diagnostic the deploy itself will surface properly.
    public static func check(siteDirectory: URL, settings: SiteSettings) async -> SourceBundleStatus {
        let configURL = siteDirectory.appendingPathComponent(".site-config")
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_SOURCE_BUCKET", in: config) != nil else { return .notConfigured }
        guard let uploadedCommit = settings.deployedSourceBundleCommit else { return .notYetUploaded }

        guard let headResult = try? await BackupCommand.defaultRunner(siteDirectory, ["rev-parse", "HEAD"]),
              headResult.exitCode == 0
        else { return .upToDate }   // can't determine HEAD — fail quiet, not alarming
        let currentCommit = headResult.stdout.trimmingCharacters(in: .whitespacesAndNewlines)

        return currentCommit == uploadedCommit
            ? .upToDate
            : .dirty(uploadedCommit: uploadedCommit, currentCommit: currentCommit)
    }
}
