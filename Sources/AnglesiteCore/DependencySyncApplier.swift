import Foundation

/// Applies an accepted dependency-sync update (spec §6): rewrites `package.json`'s
/// version ranges, deletes the now-stale `package-lock.json` (so the next preview
/// boot's existing `hydrate.sh` regenerates one via its normal `npm install` path —
/// no new container-exec machinery), refreshes the baseline, and bumps the
/// `ANGLESITE_VERSION` stamp. The lockfile delete, baseline save, and version bump
/// are best-effort (`try?`) once the package.json rewrite itself has succeeded —
/// none of them are things the user's file-open flow should hard-fail on.
public enum DependencySyncApplier {
    /// The only failures `apply` surfaces — both about the `package.json` rewrite itself. Every
    /// later step (lockfile delete, baseline save, version stamp) is deliberately best-effort
    /// and never reaches the caller (see the type doc comment).
    public enum ApplyError: Error, Equatable {
        /// `Source/package.json` couldn't be read — nothing was modified.
        case readFailed
        /// The rewritten `package.json` couldn't be written back; the atomic write means the
        /// original file is still intact.
        case writeFailed
    }

    /// Applies accepted `offers` to the site: rewrites `Source/package.json`'s version ranges,
    /// then best-effort deletes the stale lockfile, folds the offered ranges into the
    /// ``DependencyBaseline``, and stamps `.site-config`'s `ANGLESITE_VERSION` with
    /// `runningAppVersion` so ``DependencySyncChecker``'s fast-path gate skips this site until
    /// the app itself updates again.
    /// - Throws: `ApplyError` only when `package.json` can't be read or written — the one step
    ///   whose failure would leave the offer silently unapplied.
    public static func apply(
        _ offers: [DependencyUpdateOffer],
        sourceDirectory: URL,
        configDirectory: URL,
        runningAppVersion: String
    ) throws {
        let packageJSONURL = sourceDirectory.appendingPathComponent("package.json")
        guard let originalText = try? String(contentsOf: packageJSONURL, encoding: .utf8) else {
            throw ApplyError.readFailed
        }
        let updatedText = PackageJSONDependencies.apply(offers, to: originalText)
        do {
            try updatedText.write(to: packageJSONURL, atomically: true, encoding: .utf8)
        } catch {
            throw ApplyError.writeFailed
        }

        try? FileManager.default.removeItem(at: sourceDirectory.appendingPathComponent("package-lock.json"))

        var newBaseline = DependencyBaseline.load(from: configDirectory) ?? [:]
        for offer in offers { newBaseline[offer.name] = offer.offeredRange }
        try? DependencyBaseline.save(newBaseline, to: configDirectory)

        let siteConfigURL = sourceDirectory.appendingPathComponent(".site-config")
        let existingConfig = (try? String(contentsOf: siteConfigURL, encoding: .utf8)) ?? ""
        let updatedConfig = SiteConfigFile.upsert([("ANGLESITE_VERSION", runningAppVersion)], into: existingConfig)
        try? updatedConfig.write(to: siteConfigURL, atomically: true, encoding: .utf8)
    }
}
