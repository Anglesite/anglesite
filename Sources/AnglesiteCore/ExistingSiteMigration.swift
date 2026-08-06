import Foundation

/// Runs every existing-site migration step (script-file sync's legacy-unclassified case,
/// `SecurityTxtMigrationChecker`/`Applier`) with every decision defaulted to Preserve, for a
/// caller with no UI to ask through — `SiteOperations`'s headless App Intents/Shortcuts/Siri path
/// (design doc "Noninteractive flows"). The windowed `SiteWindowModel.loadAndStart()` path does
/// **not** use this type — it composes the same checkers/appliers directly so it can show a sheet
/// and await a real decision; this exists so the headless path gets the same coverage without
/// re-implementing the same sequencing with different defaults.
public enum ExistingSiteMigration {
    private static let commitMessage = "chore: migrate existing site to current template baseline"

    /// Applies every silently-safe script action, defaults every script divergence to "keep
    /// mine" (Preserve), defaults every `security.txt` decision to Preserve, commits whatever
    /// changed, and logs an actionable message to `source` for anything left with unresolved
    /// ownership. Best-effort throughout — a failure at any step is logged and does not stop the
    /// rest, since this runs ahead of a deploy that should still proceed whenever possible.
    /// `templateDirectory` is `nil` when the bundled template can't be resolved (matches the
    /// existing `TemplateRuntime.bundledURL()` guard in `SiteWindowModel`); script-file migration
    /// is skipped in that case, but `security.txt`/`.gitignore` migration still runs since it
    /// needs no template.
    public static func runNoninteractively(
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL?,
        source: String,
        logCenter: LogCenter = .shared
    ) async {
        await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: sourceDirectory, configDirectory: configDirectory, message: commitMessage
        )

        var touched: [String] = []
        var unresolved: [String] = []

        if let templateDirectory {
            let plan = TemplateScriptsSyncChecker.check(
                sourceDirectory: sourceDirectory, configDirectory: configDirectory, templateDirectory: templateDirectory
            )
            if !plan.toApply.isEmpty {
                if (try? TemplateScriptsSyncApplier.applyQueued(
                    plan.toApply, sourceDirectory: sourceDirectory, configDirectory: configDirectory,
                    templateDirectory: templateDirectory
                )) != nil {
                    touched += plan.toApply.map(\.relativePath)
                }
            }
            // Every divergence — a genuine hand-edit or an unclassified legacy file (Task 3) — is
            // left exactly as-is: `.keepMine` writes nothing under `Source/`, only records the
            // acknowledgement, so there is nothing to add to `touched` here.
            unresolved += plan.divergences.map(\.relativePath)
        }

        switch SecurityTxtMigrationChecker.check(sourceDirectory: sourceDirectory) {
        case .nothingToDo:
            break
        case .silentBackfillMode(let mode):
            touched += SecurityTxtMigrationApplier.applyBackfill(mode: mode, sourceDirectory: sourceDirectory)
        case .silentAdopt:
            // The app already positively resolved this — marker-owned, or an unmarked file that
            // exactly matches the old generator's shape — so it applies the same way an
            // unmodified `scripts/` file silently refreshes, no decision needed even
            // interactively.
            touched += SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory: sourceDirectory)
        case .needsDecision:
            // Noninteractive default: Preserve. `SECURITY_TXT_MODE=manual` is still an explicit,
            // durable decision — it just never rewrites the file or touches `.gitignore` toward
            // "ignored."
            touched += SecurityTxtMigrationApplier.applyDecision(.preserve, sourceDirectory: sourceDirectory)
            unresolved.append("public/.well-known/security.txt")
        }

        let committed = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: touched, sourceDirectory: sourceDirectory, configDirectory: configDirectory,
            message: commitMessage
        )
        if !committed {
            await logCenter.append(
                source: source, stream: .stderr,
                text: "Existing-site migration wrote files but couldn't commit them — they'll be retried on the next open."
            )
        }
        if !unresolved.isEmpty {
            await logCenter.append(
                source: source, stream: .stdout,
                text: "Existing-site migration left \(unresolved.count) file(s) with unresolved ownership (kept as-is): \(unresolved.joined(separator: ", "))."
            )
        }
    }
}
