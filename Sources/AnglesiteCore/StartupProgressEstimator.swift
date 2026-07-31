import Foundation

/// The coarse milestone a dev-server startup is currently at. Drives both the progress bar's fill
/// range and the curated message shown beneath it.
public enum StartupPhase: String, Sendable, Equatable, CaseIterable {
    /// No startup in progress (initial state, or reset after the runtime went back to idle).
    case idle
    /// The runtime reported `.starting` — the dev-server process is being spawned.
    case launching
    /// First astro stdout arrived: the process is alive and Astro/Vite is doing its build work.
    case building
    /// The dev server printed its ready URL; the preview WebView is connecting to it.
    case connecting
    /// The runtime reported `.ready` — the bar jumps to full.
    case ready
    /// Startup failed before reaching `.ready`. A crash *after* `.ready` never lands here — that
    /// is a runtime concern the error pane owns, not a startup one.
    case failed

    /// Forward-only ordering. The estimator only ever advances to a higher-ranked active phase.
    /// Note: `.failed` and `.idle` are reset directly in `ingest(runtimeState:)` and never reached
    /// through the forward-only `enter(_:at:)`, so their rank ordering relative to `.ready` is not
    /// load-bearing.
    var rank: Int {
        switch self {
        case .idle:       return 0
        case .launching:  return 1
        case .building:   return 2
        case .connecting: return 3
        case .ready:      return 4
        case .failed:     return 5
        }
    }

    /// `[start, cap]` fraction band the bar occupies while in this phase. The smooth fill eases
    /// from `start` toward `cap` but only the next real anchor crosses into the following band.
    var fillRange: (start: Double, cap: Double) {
        switch self {
        case .idle, .failed: return (0, 0)
        case .launching:     return (0.0, 0.15)
        case .building:      return (0.15, 0.55)
        case .connecting:    return (0.55, 0.90)
        case .ready:         return (1.0, 1.0)
        }
    }

    /// The curated status line shown beneath the progress bar while this phase is active. Empty
    /// for the non-active phases — the bar isn't shown then, so there's nothing to caption.
    public var message: String {
        switch self {
        case .idle, .failed, .ready: return ""
        case .launching:  return "Starting dev server…"
        case .building:   return "Building site…"
        case .connecting: return "Connecting to preview…"
        }
    }

    /// How many of the three phase-progress-strip panels (see
    /// docs/superpowers/specs/2026-07-28-phase-progress-panels-design.md) should read as filled
    /// for this phase. Cumulative: once a panel fills at an earlier phase it stays filled at every
    /// later phase — this only ever needs to name the count for the *current* phase because the
    /// view renders "filled" as "index < filledCount", not a stateful toggle.
    public var panelFillCount: Int {
        switch self {
        case .idle, .failed:        return 0
        case .launching, .building: return 1
        case .connecting:           return 2
        case .ready:                return 3
        }
    }
}

/// Pure, time-base-agnostic state machine that turns startup signals into a determinate progress
/// fraction and a phase message. It is driven entirely by its caller — runtime-state changes, the
/// site's `astro` stdout lines, and periodic `tick`s — with timestamps supplied as parameters, so
/// it carries no clock and is trivially testable. The `StartupProgressModel` (AnglesiteApp) owns
/// the clock, the `LogCenter` subscription, and persistence.
///
/// Fill is anchored by real milestones and eased between them using a `StartupProfile`: within a
/// phase the fraction approaches — but never reaches — that phase's cap, so the bar keeps inching
/// on overrun and only a genuine anchor completes a segment. `.ready` jumps to `1.0`.
public struct StartupProgressEstimator: Sendable, Equatable {
    /// The current milestone. Advances forward-only through the active phases; only a runtime
    /// `.failed`/`.idle` signal resets it.
    public private(set) var phase: StartupPhase = .idle
    /// Determinate progress in `0...1`, monotonic within a startup — it never moves backward, so
    /// the bar never visibly regresses even when signals arrive out of the expected cadence.
    public private(set) var fraction: Double = 0

    private let profile: StartupProfile
    private var phaseEnteredAt: TimeInterval = 0
    private var anchorTimes: [StartupPhase: TimeInterval] = [:]

    /// How sharply the fill approaches the cap. At `elapsed == expectedSegment` the bar is ~92% of
    /// the way across the band; it asymptotes to (but never reaches) the cap thereafter.
    private static let easeK = 2.5
    private static let fractionEpsilon = 0.0001

    /// Creates an estimator paced by `profile` — typically the last successful startup's measured
    /// timings (``StartupTimingStore``), so the smooth fill matches how long *this site* usually
    /// takes rather than a one-size-fits-all guess.
    public init(profile: StartupProfile = .default) {
        self.profile = profile
    }

    /// The current phase's curated status line (see ``StartupPhase/message``).
    public var message: String { phase.message }

    /// `true` while a startup is genuinely in flight (launching/building/connecting) — the window
    /// in which the caller should keep `tick`ing and feeding log lines. `false` for the terminal
    /// and idle states, where every ingest/tick becomes a no-op.
    public var isActive: Bool {
        phase == .launching || phase == .building || phase == .connecting
    }

    /// After a successful startup, the measured per-segment durations — for persisting back to the
    /// `StartupTimingStore`. `nil` until `.ready`. Missing intermediate anchors collapse to zero-
    /// length segments (e.g. a URL line that arrived before any other astro output).
    public var completedProfile: StartupProfile? {
        guard phase == .ready,
              let tLaunch = anchorTimes[.launching],
              let tReady = anchorTimes[.ready] else { return nil }
        let tBuild = anchorTimes[.building] ?? tLaunch
        let tConn = anchorTimes[.connecting] ?? tBuild
        return StartupProfile(
            launchingToBuilding: max(tBuild - tLaunch, 0),
            buildingToConnecting: max(tConn - tBuild, 0),
            connectingToReady: max(tReady - tConn, 0)
        )
    }

    /// Drive launching/ready/failed anchors off the runtime's state machine.
    public mutating func ingest(runtimeState: SiteRuntimeState, at now: TimeInterval) {
        switch runtimeState {
        case .starting:
            enter(.launching, at: now)
        case .ready:
            enter(.ready, at: now)
        case .failed:
            // A crash *after* a successful start is a runtime concern, not a startup one — the
            // error pane handles it; don't clobber the completed bar.
            guard phase != .ready else { return }
            phase = .failed
            fraction = 0
        case .idle:
            guard phase != .ready else { return }
            phase = .idle
            fraction = 0
            anchorTimes = [:]
        }
    }

    /// Drive building/connecting anchors off the site's dev-server stdout. The caller is responsible
    /// for filtering to that site's runtime stream before calling.
    public mutating func ingest(logText: String, at now: TimeInterval) {
        guard isActive else { return }
        if Self.parseReadyURL(logText) != nil {
            enter(.connecting, at: now)
        } else {
            enter(.building, at: now)
        }
    }

    /// Ease the fraction toward the current phase's cap, paced by the expected segment duration.
    /// No-op once the startup is no longer active.
    public mutating func tick(now: TimeInterval) {
        guard isActive else { return }
        let (start, cap) = phase.fillRange
        let expected = max(expectedSegment(for: phase), 0.05)
        let r = max(now - phaseEnteredAt, 0) / expected
        let eased = 1 - exp(-Self.easeK * r)               // 0 at r=0, →1, never 1
        let target = start + (cap - start) * eased
        // Monotonic, and strictly below the cap so only a real anchor can cross into the next band.
        fraction = min(max(fraction, target), cap - Self.fractionEpsilon)
    }

    // MARK: - Internals

    /// Expected duration of the segment we wait through *while in* `phase`.
    private func expectedSegment(for phase: StartupPhase) -> TimeInterval {
        switch phase {
        case .launching:  return profile.launchingToBuilding
        case .building:   return profile.buildingToConnecting
        case .connecting: return profile.connectingToReady
        default:          return 0
        }
    }

    /// Advance to a higher-ranked phase, recording its anchor time and snapping the fraction up to
    /// the new band's start. Lower-or-equal ranks are ignored (forward-only).
    private mutating func enter(_ newPhase: StartupPhase, at now: TimeInterval) {
        guard newPhase.rank > phase.rank else { return }
        anchorTimes[newPhase] = now
        phaseEnteredAt = now
        phase = newPhase
        fraction = max(fraction, newPhase.fillRange.start)
    }

    private static func parseReadyURL(_ text: String) -> URL? {
        // Mirrors the pre-#70 dev-server ready-URL parser/ANSI-stripper so a log line still
        // parses the same way it did before host Node retirement. The `?` in the ANSI class
        // matters: CSI private-mode sequences (e.g. `ESC[?25l`, used to hide/show the cursor)
        // wouldn't be stripped without it.
        let cleaned = text.replacingOccurrences(
            of: #"\u{001B}\[[0-9;?]*[A-Za-z]"#,
            with: "",
            options: .regularExpression
        )
        guard let range = cleaned.range(
            of: #"https?://[^\s/]+(?::\d+)?(?:/[^\s]*)?"#,
            options: .regularExpression
        ) else {
            return nil
        }
        let candidate = String(cleaned[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
        return URL(string: candidate)
    }
}
