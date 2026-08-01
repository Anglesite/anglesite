import Foundation
import AnglesiteCore

/// Wires Deploy/Backup/Audit phase transitions to the completion notifier and the Dock-tile
/// progress bar (#526). Thin glue by design: wording lives in `CompletionNoticeBuilder` and the
/// milestone→fraction mapping in `DeployDockProgress` (both unit-tested in `AnglesiteCore`);
/// these closures only forward phase data.
///
/// Extracted from `SiteWindowModel.wireCompletionHooks`/`postNotice` (#822) as one of its four
/// embedded subsystems. Stateless by design (a namespace, not a composed controller like
/// `InvisiblePublishCoordinator`/`SecurityScopedGrantController`): `SiteWindowModel.init` calls
/// `wire(deploy:backup:audit:)` exactly once and never needs to reach back into this type again.
///
/// Deliberately captures **nothing** from the calling `SiteWindowModel`. Closing a window does
/// *not* stop an in-flight operation: the models' `Task { [weak self] in await self?.run…() }`
/// retains the model strongly for the whole async call (the optional-chained receiver is kept
/// alive across every suspension inside it), so an abandoned operation runs to a real terminal
/// phase after the window model is gone — and must still notify, since "the window is no longer
/// watching" is exactly the case the feature covers. The site id therefore arrives from the model
/// per-run (so a window replayed onto a different site can't mis-attribute a still-in-flight
/// run), and the display name is resolved fresh from `SiteStore` at post time (so a rename
/// mid-run notifies under the current name). Dock state is likewise driven entirely by the run's
/// own transitions — every terminal phase clears its token, so no close-time cleanup is needed
/// (or correct: an eager clear would just be re-added by the still-running deploy's next
/// milestone).
@MainActor
enum CompletionNotificationHub {
    static func wire(deploy: DeployModel, backup: BackupModel, audit: AuditModel) {
        deploy.onPhaseTransition = { siteID, phase in
            let dockToken = "deploy:\(siteID)"
            switch phase {
            case .idle:
                DockProgressController.shared.clear(token: dockToken)
            case .running:
                // Indeterminate until the first structured milestone arrives.
                DockProgressController.shared.update(fraction: nil, for: dockToken)
            case .succeeded(let url, let duration):
                DockProgressController.shared.clear(token: dockToken)
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.deploy(
                        siteName: name, siteID: siteID,
                        outcome: .succeeded(url: url.absoluteString, duration: duration)
                    )
                }
            case .failed(let reason, _):
                // Command-produced reasons already carry the exit code where it matters
                // ("npm run build failed (exit 1)"), so don't append it again here.
                DockProgressController.shared.clear(token: dockToken)
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.deploy(siteName: name, siteID: siteID, outcome: .failed(reason: reason))
                }
            case .blocked(let failures, _):
                DockProgressController.shared.clear(token: dockToken)
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.deploy(
                        siteName: name, siteID: siteID, outcome: .blocked(failureCount: failures.count)
                    )
                }
            case .workerNameConflict:
                // The conflict sheet (wired separately) carries the actionable info, and the
                // deploy is parked rather than finished — no completion notice, just stop
                // showing progress on the Dock tile.
                DockProgressController.shared.clear(token: dockToken)
            case .webmentionPaidPlanConfirmationNeeded:
                // Same reasoning as `.workerNameConflict` — the confirmation sheet (wired
                // separately) carries the actionable info, and the deploy is parked rather than
                // finished.
                DockProgressController.shared.clear(token: dockToken)
            case .domainConfigDrift(let findings):
                // Unlike `.workerNameConflict`, this deploy isn't parked for an in-app retry — it
                // just stopped, like `.blocked` — so it does get a completion notice.
                DockProgressController.shared.clear(token: dockToken)
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.deploy(
                        siteName: name, siteID: siteID, outcome: .domainConfigDrift(findingCount: findings.count)
                    )
                }
            }
        }
        deploy.onMilestone = { siteID, progress in
            guard progress.kind == .deploy else { return }
            DockProgressController.shared.update(
                fraction: DeployDockProgress.fraction(forPhase: progress.phase),
                for: "deploy:\(siteID)"
            )
        }

        backup.onPhaseTransition = { siteID, phase in
            switch phase {
            case .idle, .running:
                break
            case .succeeded(let sha, let branch, let remote, _):
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.backup(
                        siteName: name, siteID: siteID,
                        outcome: .succeeded(commitSHA: sha, branch: branch, remote: remote)
                    )
                }
            case .noChanges:
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.backup(siteName: name, siteID: siteID, outcome: .noChanges)
                }
            case .failed(let reason, _):
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.backup(siteName: name, siteID: siteID, outcome: .failed(reason: reason))
                }
            }
        }

        audit.onPhaseTransition = { siteID, phase in
            switch phase {
            case .idle, .running:
                break
            case .succeeded(let report, _):
                let counts = Dictionary(grouping: report.findings, by: \.severity).mapValues(\.count)
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.audit(
                        siteName: name, siteID: siteID,
                        outcome: .succeeded(
                            criticalCount: counts[.critical, default: 0],
                            warningCount: counts[.warning, default: 0],
                            infoCount: counts[.info, default: 0]
                        )
                    )
                }
            case .failed(let reason, _, _):
                postNotice(siteID: siteID) { name in
                    CompletionNoticeBuilder.audit(siteName: name, siteID: siteID, outcome: .failed(reason: reason))
                }
            }
        }
    }

    /// Resolve the site's *current* display name from the registry and hand the notice to the
    /// notifier (which applies the settings toggle and the not-frontmost gate). The posting path
    /// must not depend on the window model still existing — an operation whose window closed
    /// mid-run finishes later and still notifies. A site removed from the registry mid-run posts
    /// with an empty subtitle rather than not at all.
    private static func postNotice(siteID: String, _ make: @escaping @MainActor (String) -> CompletionNotice) {
        Task { @MainActor in
            let name = await SiteStore.shared.find(id: siteID)?.name ?? ""
            CompletionNotifier.shared.post(make(name))
        }
    }
}
