import SwiftUI
import AnglesiteCore

/// Drives the determinate startup progress bar for one site window. Owns a pure
/// `StartupProgressEstimator` and feeds it three things: runtime-state changes (pushed in by
/// `SiteWindow` via `ingest(state:)`), the site's `container:<id>` stdout lines (subscribed from
/// `LogCenter`), and ~20 fps `tick`s that ease the fill forward. On success it persists the
/// measured timing so the next startup paces itself. The estimator stays host-independent and
/// CI-tested; this class is the SwiftUI/actor wiring around it.
@MainActor
@Observable
final class StartupProgressModel {
    private(set) var phase: StartupPhase = .idle
    private(set) var fraction: Double = 0
    private(set) var message: String = ""
    /// True for a brief window after reaching `.ready`, so `SiteWindow` can hold the fully-filled
    /// phase progress strip on screen for a moment before swapping to the live preview — without
    /// this, reaching `.ready` and the pane swap happen in the same update and the completed
    /// strip (`StartupPhase.ready.panelFillCount == 3`) renders for ~0 frames. Doesn't affect
    /// `phase`/`fraction`/`message`, which still report `.ready` immediately — only the view's
    /// swap decision is delayed.
    private(set) var isShowingCompletionHold = false

    private let timingStore: StartupTimingStore
    private let logCenter: LogCenter
    private let soundEffect: DialupSoundEffectPlaying
    private let clock: @Sendable () -> TimeInterval

    private var estimator = StartupProgressEstimator()
    private var siteID: String?
    private var logTask: Task<Void, Never>?
    private var tickTask: Task<Void, Never>?
    private var holdTask: Task<Void, Never>?

    init(
        timingStore: StartupTimingStore = .shared,
        logCenter: LogCenter = .shared,
        // `soundEffect` can't default directly to `DialupSoundEffectPlayer()` here: under this
        // project's Swift 5.10 language mode (project.yml's SWIFT_VERSION, not Swift 6 mode),
        // a default-argument expression that calls a `@MainActor`-isolated initializer is
        // rejected as a call "in a synchronous nonisolated context," even though this
        // initializer's enclosing type (and thus the init itself) is `@MainActor`. Defaulting
        // to `nil` and constructing the real player in the (actor-isolated) init body sidesteps
        // that restriction while keeping the same effective default and injectability for tests.
        soundEffect: DialupSoundEffectPlaying? = nil,
        clock: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    ) {
        self.timingStore = timingStore
        self.logCenter = logCenter
        self.soundEffect = soundEffect ?? DialupSoundEffectPlayer()
        self.clock = clock
    }

    /// Push a runtime-state change. `.starting` (re)arms tracking for the site; `.ready` records
    /// timing and completes the bar; `.failed`/`.idle` tear the tracker down.
    func ingest(state: SiteRuntimeState) {
        switch state {
        case .starting(let id):
            begin(siteID: id)
        case .ready(let id, _, _):
            estimator.ingest(runtimeState: state, at: clock())
            if let profile = estimator.completedProfile {
                timingStore.record(profile, for: id)
            }
            publish()
            stop()
            beginCompletionHold()
        case .failed, .idle:
            estimator.ingest(runtimeState: state, at: clock())
            publish()
            stop()
        }
    }

    /// Cancel the log subscription and ticker. Safe to call repeatedly.
    func stop() {
        logTask?.cancel(); logTask = nil
        tickTask?.cancel(); tickTask = nil
        holdTask?.cancel(); holdTask = nil
        isShowingCompletionHold = false
        soundEffect.stop()
    }

    // MARK: - Internals

    private func begin(siteID: String) {
        // Re-arm only on a genuinely new startup; ignore a duplicate `.starting` for the same site.
        if self.siteID == siteID && estimator.isActive { return }
        self.siteID = siteID
        estimator = StartupProgressEstimator(profile: timingStore.profile(for: siteID))
        estimator.ingest(runtimeState: .starting(siteID: siteID), at: clock())
        soundEffect.play()
        publish()
        subscribeToLogs(siteID: siteID)
        startTicker()
    }

    private func subscribeToLogs(siteID: String) {
        logTask?.cancel()
        // `LocalContainerSiteRuntime` is the only `SiteRuntime` that currently streams to
        // `LogCenter`, tagged `container:<id>` (see `LocalContainerSiteRuntime.swift`).
        // `RemoteSandboxSiteRuntime` doesn't stream logs yet; when it does, it should use the
        // same tag scheme so this subscription picks it up too.
        let source = "container:\(siteID)"
        logTask = Task { @MainActor [weak self] in
            guard let center = self?.logCenter else { return }
            let subscription = await center.subscribe()
            for await line in subscription.stream {
                guard let self else { break }
                if Task.isCancelled { break }
                guard line.source == source, line.stream == .stdout else { continue }
                guard self.estimator.isActive else { break }
                self.estimator.ingest(logText: line.text, at: self.clock())
                self.publish()
            }
            subscription.cancel()
        }
    }

    /// Keeps `isShowingCompletionHold` true for ~0.5s after `.ready`, then clears it. `stop()`
    /// (called for every terminal/reset transition, including this one just before this method
    /// runs) always cancels any prior hold first, so this never overlaps a stale one.
    private func beginCompletionHold() {
        isShowingCompletionHold = true
        holdTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            self?.isShowingCompletionHold = false
        }
    }

    private func startTicker() {
        tickTask?.cancel()
        tickTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, self.estimator.isActive else { return }
                self.estimator.tick(now: self.clock())
                self.publish()
                try? await Task.sleep(nanoseconds: 50_000_000) // ~20 fps
            }
        }
    }

    private func publish() {
        phase = estimator.phase
        fraction = estimator.fraction
        message = estimator.message
    }
}
