import Foundation
import Observation

/// Severity of a single capability check. `unsupported` means "not available in this
/// build/OS yet" (a truthful absence, not a failure the user caused).
public enum ReadinessLevel: String, Sendable, Equatable, CaseIterable {
    /// The capability is present and working.
    case ok
    /// Usable but degraded, or waiting on something (a user action, a download) to reach
    /// full capability.
    case warning
    /// The capability is broken in a way that blocks Siri workflows — usually with a
    /// remediation the user can act on.
    case failure
    /// Truthfully absent in this build/OS/hardware; not the user's fault and not
    /// remediable, so it must not be styled as an error.
    case unsupported
}

/// The result of one probe. Concrete `detail` (what the probe found), with optional
/// user-actionable `remediation`.
public struct ReadinessFinding: Identifiable, Sendable, Equatable {
    /// Stable identifier, echoing the producing probe's ``ReadinessProbe/id`` so findings can
    /// be correlated across rechecks.
    public let id: String
    /// User-facing check title. Carried on the finding rather than the probe — see
    /// ``ReadinessProbe`` for why.
    public let title: String
    /// Severity of what the probe found.
    public let level: ReadinessLevel
    /// What the probe concretely observed, phrased for the user.
    public let detail: String
    /// A user-actionable next step, or `nil` when there is nothing for the user to do
    /// (an ok finding, or an ``ReadinessLevel/unsupported`` one).
    public let remediation: String?

    /// Creates a finding. `remediation` defaults to `nil` for findings that need no user
    /// action.
    public init(id: String, title: String, level: ReadinessLevel, detail: String, remediation: String? = nil) {
        self.id = id
        self.title = title
        self.level = level
        self.detail = detail
        self.remediation = remediation
    }
}

/// A single capability check. Never throws — a failure is a `ReadinessFinding` with a
/// failing `level`. Injectable so tests can supply canned probes.
///
/// The user-facing title is carried by the `ReadinessFinding` each probe returns, so it is not
/// part of the protocol surface — consumers read `finding.title`, never `probe.title`.
public protocol ReadinessProbe: Sendable {
    /// Stable identifier for this check, echoed into the returned finding's
    /// ``ReadinessFinding/id``.
    var id: String { get }
    /// Runs the check. Must not throw — encode any failure as a finding with a failing
    /// ``ReadinessFinding/level`` so the readiness surface always has something to show.
    func check() async -> ReadinessFinding
}

/// Drives a readiness surface. Mirrors `HealthModel`: `@MainActor @Observable`, injectable
/// dependencies, `recheck()` returns the `Task` so tests can await it. Probes run serially
/// for deterministic ordering.
@MainActor
@Observable
public final class SiriReadinessModel: Identifiable {
    /// Identity lets the readiness sheet bind via `.sheet(item:)`.
    public nonisolated var id: ObjectIdentifier { ObjectIdentifier(self) }

    /// Findings from the most recent *completed* run, in probe order (probes run serially, so
    /// the surface's row order is deterministic). Empty until the first ``recheck()`` commits;
    /// a cancelled or superseded run never publishes partial results.
    public private(set) var findings: [ReadinessFinding] = []
    /// Whether a run is in flight — drives the surface's progress indicator. Only the run
    /// that owns the current generation may clear it (see `cancelled(_:)`).
    public private(set) var isChecking: Bool = false
    /// When the last completed run committed, from the injected clock; `nil` until then.
    public private(set) var lastChecked: Date?

    @ObservationIgnored private let probes: [any ReadinessProbe]
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var inFlight: Task<Void, Never>?
    /// Bumped on every `recheck()`. A cancelled run uses it to tell "I was cancelled and nobody
    /// replaced me" (clear the spinner) from "a newer run superseded me" (leave its spinner alone).
    @ObservationIgnored private var generation = 0

    /// Creates the model with its probe set fixed for the model's lifetime. `now` is
    /// injectable so tests can pin ``lastChecked`` to a deterministic clock.
    public init(probes: [any ReadinessProbe], now: @escaping @Sendable () -> Date = { Date() }) {
        self.probes = probes
        self.now = now
    }

    /// Worst level across all findings. Empty / all-unsupported collapses to `.unsupported`.
    public var overallLevel: ReadinessLevel {
        if findings.contains(where: { $0.level == .failure }) { return .failure }
        if findings.contains(where: { $0.level == .warning }) { return .warning }
        if findings.contains(where: { $0.level == .ok }) { return .ok }
        return .unsupported
    }

    /// Run every probe and publish the findings. Cancels any in-flight run first.
    @discardableResult
    public func recheck() -> Task<Void, Never> {
        inFlight?.cancel()
        generation += 1
        let runGeneration = generation
        isChecking = true
        let probes = self.probes
        let task = Task { @MainActor [weak self] in
            var collected: [ReadinessFinding] = []
            for probe in probes {
                if Task.isCancelled { self?.cancelled(runGeneration); return }
                collected.append(await probe.check())
            }
            guard !Task.isCancelled else { self?.cancelled(runGeneration); return }
            self?.commit(collected)
        }
        inFlight = task
        return task
    }

    private func commit(_ findings: [ReadinessFinding]) {
        self.findings = findings
        self.lastChecked = now()
        self.isChecking = false
    }

    /// Clear the spinner for a cancelled run — but only if no later `recheck()` has superseded it.
    /// A newer run owns `isChecking` (it set its own `true` and will `commit`), so a stale
    /// cancellation must not flip it back to `false` underneath the live run.
    private func cancelled(_ runGeneration: Int) {
        guard runGeneration == generation else { return }
        isChecking = false
    }
}
