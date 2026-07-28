import Foundation
import os

/// Detects which app-owned `scripts/` files a site needs refreshed, and which have been
/// customized in a way the app can't silently resolve (design doc, #1053). Unlike
/// `DependencySyncChecker`, this type performs its own `Config/`-only baseline bookkeeping
/// (backfilling a missing entry, initializing a first-encounter baseline) as it goes — see the
/// design doc's "Note on checker purity." It never writes anything under `Source/`; only
/// `TemplateScriptsSyncApplier` does that.
public enum TemplateScriptsSyncChecker {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "TemplateScriptsSyncChecker")

    public static func check(
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL
    ) -> TemplateScriptsSyncPlan {
        var baseline = TemplateScriptsBaseline.load(from: configDirectory)
        var baselineChanged = false
        var toApply: [TemplateScriptsSyncAction] = []
        var divergences: [TemplateScriptsDivergence] = []

        for relativePath in TemplateScriptsManifest.appOwnedRelativePaths(templateRoot: templateDirectory) {
            guard let templateContent = try? String(
                contentsOf: templateDirectory.appendingPathComponent(relativePath), encoding: .utf8
            ) else { continue }
            let templateHash = VectorMath.stableHash(templateContent)

            let siteURL = sourceDirectory.appendingPathComponent(relativePath)
            guard FileManager.default.fileExists(atPath: siteURL.path) else {
                // Genuinely absent — the template added this file since the site scaffolded.
                // Nothing of the owner's to lose, so this is safe to create silently.
                toApply.append(.create(relativePath: relativePath))
                continue
            }
            guard let siteContent = try? String(contentsOf: siteURL, encoding: .utf8) else {
                // The file exists but couldn't be read as UTF-8 — permissions, a transient I/O
                // error, or genuinely non-UTF-8 content. Unlike "doesn't exist," this is NOT safe
                // to silently overwrite (there may be something of the owner's to lose), so skip
                // it entirely rather than guessing; logged so it isn't invisible.
                logger.error(
                    "Skipping \(relativePath, privacy: .public): exists but couldn't be read as UTF-8"
                )
                continue
            }
            let siteHash = VectorMath.stableHash(siteContent)

            if templateHash == siteHash {
                if baseline.files[relativePath]?.baselineHash != siteHash {
                    baseline.files[relativePath] = TemplateScriptsBaseline.Entry(baselineHash: siteHash)
                    baselineChanged = true
                }
                continue
            }

            if baseline.files[relativePath] == nil {
                // First encounter for this site: its current content becomes the assumed-untouched
                // baseline (design doc's legacy-site trade-off).
                baseline.files[relativePath] = TemplateScriptsBaseline.Entry(baselineHash: siteHash)
                baselineChanged = true
            }
            let entry = baseline.files[relativePath]!

            if entry.baselineHash == siteHash {
                toApply.append(.refresh(relativePath: relativePath))
            } else if entry.acknowledgedTemplateHash == templateHash {
                continue
            } else {
                divergences.append(TemplateScriptsDivergence(relativePath: relativePath, templateHash: templateHash))
            }
        }

        if baselineChanged {
            try? baseline.save(to: configDirectory)
        }
        return TemplateScriptsSyncPlan(toApply: toApply, divergences: divergences)
    }
}
