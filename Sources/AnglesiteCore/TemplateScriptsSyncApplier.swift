import Foundation

/// Applies what `TemplateScriptsSyncChecker` found (design doc §Apply/§Divergence UX). Two entry
/// points: `applyQueued` for the silent create/refresh actions (no owner consent needed — safe to
/// call unconditionally and immediately), and `resolve` for a single divergence the owner has made
/// a decision about.
public enum TemplateScriptsSyncApplier {
    public enum ApplyError: Error, Equatable {
        case templateReadFailed(relativePath: String)
        case writeFailed(relativePath: String)
    }

    public enum DivergenceDecision: Sendable, Equatable {
        /// Overwrite the owner's version with the template's (git-recoverable; design doc's
        /// resolution that `Source/` being a real git repo is sufficient recovery — no extra
        /// sibling backup file).
        case update
        /// Leave the file untouched; remember the template hash they declined.
        case keepMine
    }

    public static func applyQueued(
        _ actions: [TemplateScriptsSyncAction],
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL
    ) throws {
        guard !actions.isEmpty else { return }
        var baseline = TemplateScriptsBaseline.load(from: configDirectory)
        for action in actions {
            let relativePath = action.relativePath
            let templateURL = templateDirectory.appendingPathComponent(relativePath)
            guard let templateContent = try? String(contentsOf: templateURL, encoding: .utf8) else {
                throw ApplyError.templateReadFailed(relativePath: relativePath)
            }
            let siteURL = sourceDirectory.appendingPathComponent(relativePath)
            try? FileManager.default.createDirectory(
                at: siteURL.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            do {
                try templateContent.write(to: siteURL, atomically: true, encoding: .utf8)
            } catch {
                throw ApplyError.writeFailed(relativePath: relativePath)
            }
            baseline.files[relativePath] = TemplateScriptsBaseline.Entry(
                baselineHash: VectorMath.stableHash(templateContent)
            )
            // Persisted after each successful write, not once at the end — if a later action in
            // this same batch throws, everything already written here keeps its matching baseline
            // entry rather than losing it.
            try? baseline.save(to: configDirectory)
        }
    }

    public static func resolve(
        _ divergence: TemplateScriptsDivergence,
        decision: DivergenceDecision,
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL
    ) throws {
        var baseline = TemplateScriptsBaseline.load(from: configDirectory)
        switch decision {
        case .update:
            let templateURL = templateDirectory.appendingPathComponent(divergence.relativePath)
            guard let templateContent = try? String(contentsOf: templateURL, encoding: .utf8) else {
                throw ApplyError.templateReadFailed(relativePath: divergence.relativePath)
            }
            let siteURL = sourceDirectory.appendingPathComponent(divergence.relativePath)
            do {
                try templateContent.write(to: siteURL, atomically: true, encoding: .utf8)
            } catch {
                throw ApplyError.writeFailed(relativePath: divergence.relativePath)
            }
            baseline.files[divergence.relativePath] = TemplateScriptsBaseline.Entry(
                baselineHash: VectorMath.stableHash(templateContent)
            )
        case .keepMine:
            // The checker always records a baseline entry before ever flagging a divergence
            // (design doc §Detection step 5), so this entry exists in every real call path.
            var entry = baseline.files[divergence.relativePath]
                ?? TemplateScriptsBaseline.Entry(baselineHash: divergence.templateHash)
            entry.acknowledgedTemplateHash = divergence.templateHash
            baseline.files[divergence.relativePath] = entry
        }
        try? baseline.save(to: configDirectory)
    }
}
