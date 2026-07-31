import Foundation
import Observation

/// Per-site deploy-readiness state machine. Drives the health badge in `SiteWindow`.
///
/// Settled state is the result of the most recent run of `scripts/pre-deploy-check.ts`,
/// surfaced as either a `PreDeployCheck.Outcome` (`.passed` / `.blocked` / `.error`) or
/// a `FailureReason` for runs that couldn't produce an outcome at all (build failure,
/// runner crash). The badge color falls out of `badgeState`.
///
/// `isRunning` is a separate concern from the settled state — the view can render a
/// spinner over the existing color while a re-check is in flight, without flickering
/// back to `.unknown`.
///
/// `recheck` cancels any in-flight task before kicking a new one off (the cancelled
/// task's result, if it arrives, is discarded). `ingestDeployOutcome` exists so
/// `SiteWindow` can mirror `DeployModel`'s preflight result without re-running the
/// scan: every deploy already runs the same script.
@MainActor
@Observable
public final class HealthModel {
    /// The four-way health-badge color, collapsed from the richer settled state so the view layer
    /// never interprets outcomes itself.
    public enum BadgeState: Sendable, Equatable {
        /// No scan has produced a result this session.
        case unknown
        /// Most recent outcome: passed, no warnings.
        case clean
        /// Most recent outcome: passed, with warnings.
        case warnings
        /// Most recent outcome: blocked / error / runner failure.
        case failures
    }

    /// Why a run produced no `PreDeployCheck.Outcome` at all — distinct from a `.blocked`/`.error`
    /// outcome, where the scan itself ran fine and it's the *site* that has problems.
    public enum FailureReason: Sendable, Equatable {
        /// `npm run build` failed before the scan could run, with the runner's message.
        case buildFailed(String)
        /// The scan step itself failed (runner crash or any non-build error), with the message.
        case scanFailed(String)
    }

    /// The most recent scan outcome, or `nil` before any run settles this session.
    public private(set) var lastOutcome: PreDeployCheck.Outcome?
    /// The most recent no-outcome failure. Cleared when a later run produces a real outcome,
    /// because that outcome supersedes whatever the failure said.
    public private(set) var lastFailure: FailureReason?
    /// When the last result (outcome or failure) was committed — the badge's "as of" timestamp.
    public private(set) var lastCheckedAt: Date?
    /// Whether a re-check is in flight. Deliberately separate from the settled state so the view
    /// can spin over the existing badge color instead of flickering back to `.unknown`.
    public private(set) var isRunning: Bool = false

    private nonisolated let runner: any HealthCheckRunner
    private var inFlight: Task<Void, Never>?

    /// Creates the model around a scan runner — ``HealthCheckRunner`` is the seam that keeps this
    /// state machine testable without a real build/scan pipeline.
    public init(runner: any HealthCheckRunner) {
        self.runner = runner
    }

    /// Badge color derived from the settled state. A `lastFailure` wins over any stale
    /// `lastOutcome`: an outcome the model couldn't refresh shouldn't keep the badge green.
    public var badgeState: BadgeState {
        if lastFailure != nil { return .failures }
        guard let outcome = lastOutcome else { return .unknown }
        switch outcome {
        case .passed(let warnings):
            return warnings.isEmpty ? .clean : .warnings
        case .blocked:
            return .failures
        case .error:
            return .failures
        }
    }

    /// Spawn a re-check. Cancels any prior in-flight task. Returns the `Task` so callers
    /// (and tests) can await completion; production callers can discard it.
    @discardableResult
    public func recheck(siteID: String, siteDirectory: URL) -> Task<Void, Never> {
        inFlight?.cancel()
        isRunning = true
        let task = Task { @MainActor [weak self, runner] in
            let result: Result<PreDeployCheck.Outcome, Error>
            do {
                let outcome = try await runner.run(siteID: siteID, siteDirectory: siteDirectory)
                result = .success(outcome)
            } catch is CancellationError {
                return  // a newer recheck superseded us; drop the result silently
            } catch {
                result = .failure(error)
            }
            guard !Task.isCancelled else { return }
            self?.commit(result)
        }
        inFlight = task
        return task
    }

    /// Mirror an outcome produced by `DeployModel`'s preflight step. Clears any prior
    /// `lastFailure` because a fresh outcome supersedes whatever the last failure said.
    public func ingestDeployOutcome(_ outcome: PreDeployCheck.Outcome) {
        commit(.success(outcome))
    }

    private func commit(_ result: Result<PreDeployCheck.Outcome, Error>) {
        switch result {
        case .success(let outcome):
            lastOutcome = outcome
            lastFailure = nil
        case .failure(let error):
            if let runnerError = error as? HealthRunnerError {
                switch runnerError {
                case .build(let msg): lastFailure = .buildFailed(msg)
                case .scan(let msg): lastFailure = .scanFailed(msg)
                }
            } else {
                lastFailure = .scanFailed("\(error)")
            }
        }
        lastCheckedAt = Date()
        isRunning = false
    }
}

/// Seam between `HealthModel` and the actual scan pipeline. Production callers
/// inject `DefaultHealthCheckRunner`; tests inject a controllable mock.
///
/// Implementations should throw `HealthRunnerError.build(_:)` when `npm run build`
/// fails before the scan can run, or `HealthRunnerError.scan(_:)` for any error
/// after that. Any other error is reported by `HealthModel` as `.scanFailed("\(error)")`.
public protocol HealthCheckRunner: Sendable {
    /// Build the site and run the pre-deploy scan, returning its outcome. Throw
    /// ``HealthRunnerError`` (see the protocol doc for the build/scan split) when no outcome can
    /// be produced; respect task cancellation, since ``HealthModel/recheck(siteID:siteDirectory:)``
    /// cancels superseded runs.
    func run(siteID: String, siteDirectory: URL) async throws -> PreDeployCheck.Outcome
}

/// The two no-outcome failure modes a ``HealthCheckRunner`` distinguishes. Split so the badge can
/// tell the user "your site doesn't build" apart from "the checker itself broke" — the remedies
/// are entirely different.
public enum HealthRunnerError: Error, Sendable, Equatable {
    /// `npm run build` failed before the scan could run.
    case build(String)
    /// The scan failed after a successful build.
    case scan(String)
}
