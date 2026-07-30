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
    private var inFlight: Task<Void, Never>?

    init(
        command: AuditCommand? = nil,
        containerControlProvider: @escaping AuditCommand.ContainerControlProvider = { nil }
    ) {
        self.command = command ?? AuditCommand(containerControlProvider: containerControlProvider)
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

    /// Kicks off an audit. No-op if one is already running.
    func audit(siteID: String, siteDirectory: URL) {
        guard !isRunning else { return }
        inFlight = Task { @MainActor [weak self] in
            await self?.runAudit(siteID: siteID, siteDirectory: siteDirectory)
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

    private func runAudit(siteID: String, siteDirectory: URL) async {
        let started = Date()
        transition(siteID: siteID, to: .running(siteID: siteID, since: started))
        // Don't open the sheet during the build/audit — the running spinner lives in the
        // toolbar button. Sheet opens on terminal state so the owner sees the result.
        sheetPresented = false

        let result = await command.audit(siteID: siteID, siteDirectory: siteDirectory)
        switch result {
        case .succeeded(let report, let duration):
            transition(siteID: siteID, to: .succeeded(report: report, duration: duration))
        case .failed(let reason, let exit, let logTail):
            transition(siteID: siteID, to: .failed(reason: reason, exitCode: exit, logTail: logTail))
        }
        sheetPresented = true
    }
}
