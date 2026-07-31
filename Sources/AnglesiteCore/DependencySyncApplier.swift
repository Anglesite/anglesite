import Foundation

/// Applies an accepted dependency-sync decision (spec §6, #1108): rewrites
/// `package.json`'s version ranges and inserts any accepted new-dependency
/// entries, deletes the now-stale `package-lock.json` (so the next preview
/// boot's existing `hydrate.sh` regenerates one via its normal `npm install`
/// path — no new container-exec machinery), refreshes the baseline for both
/// updates and additions, and bumps the `ANGLESITE_VERSION` stamp. The
/// lockfile delete, baseline save, and version bump are best-effort (`try?`)
/// once the package.json rewrite itself has succeeded — none of them are
/// things the user's file-open flow should hard-fail on.
public enum DependencySyncApplier {
    public enum ApplyError: Error, Equatable {
        case readFailed
        case writeFailed
    }

    public static func apply(
        _ offers: DependencySyncOffers,
        sourceDirectory: URL,
        configDirectory: URL,
        runningAppVersion: String
    ) throws {
        let packageJSONURL = sourceDirectory.appendingPathComponent("package.json")
        guard let originalText = try? String(contentsOf: packageJSONURL, encoding: .utf8) else {
            throw ApplyError.readFailed
        }
        var updatedText = PackageJSONDependencies.apply(offers.updates, to: originalText)
        updatedText = PackageJSONDependencies.applyAdditions(offers.additions, to: updatedText)

        // Re-parse once and reuse the result for everything below. This both
        // gates the write against ever landing corrupted JSON on disk (`applyAdditions`
        // does text insertion, not just in-place substitution, so a bug there could
        // in principle produce invalid output) and tells us which offers actually
        // landed — `PackageJSONDependencies.apply`/`.applyAdditions` are both
        // best-effort and silently no-op an offer whose target name/section isn't
        // found in the site's package.json.
        guard let landedSections = try? PackageJSONDependencies.extractSections(from: updatedText) else {
            throw ApplyError.writeFailed
        }
        let landed = landedSections.dependencies.merging(landedSections.devDependencies) { _, new in new }

        do {
            try updatedText.write(to: packageJSONURL, atomically: true, encoding: .utf8)
        } catch {
            throw ApplyError.writeFailed
        }

        try? FileManager.default.removeItem(at: sourceDirectory.appendingPathComponent("package-lock.json"))

        // Seed from every dependency in the freshly-written package.json when the
        // site has no baseline yet (legacy sites scaffolded before the baseline
        // mechanism existed, or sites created via File > Import) — mirrors what
        // `SiteScaffolder` writes at scaffold time (the full template dependency
        // set, not just what changed). Without this, a site's baseline would end
        // up containing only the name(s) from *this* accepted offer, and
        // `DependencySync.diff`'s `guard let baselineRange = baseline[name]` would
        // silently withhold future bump offers for every other dependency the
        // site has.
        var newBaseline = DependencyBaseline.load(from: configDirectory) ?? landed
        // Only baseline an update/addition that actually landed in `updatedText`:
        // the merged range now equals the offered range. Applies equally to both
        // kinds — `applyAdditions` also silently skips an offer whose name is
        // already present in the target section (see its own doc comment), so an
        // addition's mere presence in `landed` doesn't prove *this* offer wrote
        // it; only an exact range match does. Baselining an offer that silently
        // no-opped would make `DependencySync.diff`'s gates think it already
        // landed and withhold it forever, with no way for the user to ever see or
        // recover it.
        for offer in offers.updates where landed[offer.name] == offer.offeredRange {
            newBaseline[offer.name] = offer.offeredRange
        }
        for offer in offers.additions where landed[offer.name] == offer.offeredRange {
            newBaseline[offer.name] = offer.offeredRange
        }
        try? DependencyBaseline.save(newBaseline, to: configDirectory)

        let siteConfigURL = sourceDirectory.appendingPathComponent(".site-config")
        let existingConfig = (try? String(contentsOf: siteConfigURL, encoding: .utf8)) ?? ""
        let updatedConfig = SiteConfigFile.upsert([("ANGLESITE_VERSION", runningAppVersion)], into: existingConfig)
        try? updatedConfig.write(to: siteConfigURL, atomically: true, encoding: .utf8)
    }
}
