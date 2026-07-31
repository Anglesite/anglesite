import Foundation

/// Applies what `TemplateScriptsSyncChecker` found (design doc §Apply/§Divergence UX). Two entry
/// points: `applyQueued` for the silent create/refresh actions (no owner consent needed — safe to
/// call unconditionally and immediately), and `resolve` for a single divergence the owner has made
/// a decision about.
public enum TemplateScriptsSyncApplier {
    /// Why an apply/resolve stopped. Both cases name the file so the caller can say which one —
    /// and, for `applyQueued`, everything written before it keeps its baseline (see that method).
    public enum ApplyError: Error, Equatable {
        /// The template's own copy couldn't be read — the bundled template is missing or
        /// unreadable, so there's nothing correct to write.
        case templateReadFailed(relativePath: String)
        /// The site-side write failed (permissions, disk); the baseline was not updated for this
        /// file, so the next check pass will retry it.
        case writeFailed(relativePath: String)
    }

    /// The owner's answer to one `TemplateScriptsDivergence` — the only decision this mechanism
    /// ever delegates to the owner (everything else is applied silently, #1053).
    public enum DivergenceDecision: Sendable, Equatable {
        /// Overwrite the owner's version with the template's (git-recoverable; design doc's
        /// resolution that `Source/` being a real git repo is sufficient recovery — no extra
        /// sibling backup file).
        case update
        /// Leave the file untouched; remember the template hash they declined.
        case keepMine
    }

    /// Writes each queued create/refresh into `sourceDirectory` and records the new baseline
    /// hash after every successful write — so a mid-batch failure leaves every file already
    /// written with its matching baseline entry intact (nothing gets re-flagged as divergent on
    /// the next pass). Throws on the first file that can't be read from the template or written
    /// to the site; earlier writes stand.
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

    /// Carries out the owner's decision for one divergence: `.update` overwrites the site's file
    /// with the template's and re-baselines it (git-recoverable — `Source/` is a real repo);
    /// `.keepMine` touches nothing under `Source/` and records the declined template hash so the
    /// same divergence isn't re-asked until the template file changes again.
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
