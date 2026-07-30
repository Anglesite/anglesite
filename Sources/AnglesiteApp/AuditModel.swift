import SwiftUI
import AnglesiteCore

/// SwiftUI-facing wrapper around `AuditCommand`. Drives one audit at a time and exposes
/// the structured `AuditReport` to `AuditSheetView`.
///
/// The audit is render-as-sheet (not drawer) because the findings list can be long —
/// fits a 600pt-tall sheet better than a 320pt drawer. The deploy drawer's live-log
/// streaming pattern would just hide the result behind a wall of `npm run build` noise
/// the moment the build settles.
@MainActor
@Observable
final class AuditModel {
    /// Resolves the local-container capability at the moment an audit actually runs, mirroring
    /// `DeployModel.ContainerControlProvider` — a container started after the model was wired up
    /// (or restarted since) is still picked up.
    typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?

    enum Phase: Equatable {
        case idle
        case running(siteID: String, since: Date)
        case succeeded(report: AuditReport, duration: TimeInterval)
        case failed(reason: String, exitCode: Int32?, logTail: [LogCenter.LogLine])
    }

    private(set) var phase: Phase = .idle

    /// Bound to a `.sheet` in `SiteWindow`. The view sets this back to false when the
    /// user dismisses; we open it whenever the phase reaches a terminal state so the
    /// owner gets the report (or failure) without a second click.
    var sheetPresented: Bool = false

    /// Fires on every phase change — start and terminal alike — with the site id of the run the
    /// transition belongs to (delivered per-run, not captured at wiring time, so a window
    /// replayed onto a different site can't mis-attribute an in-flight audit's outcome).
    /// `SiteWindowModel` wires this to the completion notifier (#526); the model stays
    /// UserNotifications-free.
    @ObservationIgnored var onPhaseTransition: ((_ siteID: String, _ phase: Phase) -> Void)?

    private let command: AuditCommand
    /// Shared with whatever `AuditCommand` this model builds for the container path (see
    /// `runAudit`), so the runner-skip log line and the build/a11y-step output land under the
    /// same `LogCenter` instance instead of silently splitting across two.
    private let logCenter: LogCenter
    private var inFlight: Task<Void, Never>?

    init(command: AuditCommand = AuditCommand(), logCenter: LogCenter = .shared) {
        self.command = command
        self.logCenter = logCenter
    }

    var isRunning: Bool {
        if case .running = phase { return true }
        return false
    }

    /// Renders the captured build log as plain text for the "Copy log" affordance on the
    /// failure sheet. Empty for non-failure phases or for failures that produced no output
    /// (e.g. spawn refusal before the build process started).
    var logText: String {
        guard case .failed(_, _, let tail) = phase else { return "" }
        return tail.map(\.text).joined(separator: "\n")
    }

    /// Kicks off an audit. No-op if one is already running. `containerControlProvider` is
    /// resolved inside `runAudit`, at the moment the audit actually runs — mirrors
    /// `DeployModel.deploy`'s identical seam.
    func audit(
        siteID: String,
        siteDirectory: URL,
        containerControlProvider: @escaping ContainerControlProvider = { nil }
    ) {
        guard !isRunning else { return }
        inFlight = Task { @MainActor [weak self] in
            await self?.runAudit(siteID: siteID, siteDirectory: siteDirectory, containerControlProvider: containerControlProvider)
        }
    }

    func dismissSheet() {
        sheetPresented = false
    }

    /// Set `phase` and notify the transition hook.
    private func transition(siteID: String, to newPhase: Phase) {
        phase = newPhase
        onPhaseTransition?(siteID, newPhase)
    }

    private func runAudit(
        siteID: String,
        siteDirectory: URL,
        containerControlProvider: @escaping ContainerControlProvider
    ) async {
        let started = Date()
        transition(siteID: siteID, to: .running(siteID: siteID, since: started))
        // Don't open the sheet during the build/audit — the running spinner lives in the
        // toolbar button. Sheet opens on terminal state so the owner sees the result.
        sheetPresented = false

        // Select the executor: in-container when the runtime is a started container; the
        // injected default (host, explicit failure) otherwise. Mirrors
        // `DeployModel.runDeploy`'s `activeCommand` selection.
        let containerControl = await containerControlProvider()
        let activeCommand: AuditCommand
        if let cc = containerControl {
            activeCommand = AuditCommand(
                logCenter: logCenter,
                executor: ContainerAuditExecutor(control: cc.control, siteID: cc.siteID, logCenter: logCenter)
            )
        } else {
            activeCommand = command
        }

        let result = await activeCommand.audit(siteID: siteID, siteDirectory: siteDirectory)
        switch result {
        case .succeeded(let report, let duration):
            transition(siteID: siteID, to: .succeeded(report: report, duration: duration))
        case .failed(let reason, let exit, let logTail):
            transition(siteID: siteID, to: .failed(reason: reason, exitCode: exit, logTail: logTail))
        }
        sheetPresented = true
    }
}
