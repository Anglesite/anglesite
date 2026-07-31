import Foundation

/// Shared observer / state-transition / generation-guard plumbing for `SiteRuntime` conformers.
///
/// Every `SiteRuntime` actor (`LocalContainerSiteRuntime`, `RemoteSandboxSiteRuntime`,
/// `UnavailableSiteRuntime`) owns one of these **by composition**, not inheritance: this type has no
/// opinion about what's being started or stopped (a container, a sandbox, nothing at all) — only the
/// mechanics every conformer needs, so the same protocol lives in exactly one place instead of three
/// drifting copies.
///
/// ## Why this isn't itself an actor
///
/// `SiteRuntime.observe()` is a non-`async` protocol requirement — callers shouldn't need to hop
/// actor isolation just to subscribe — and Swift does not allow an `async` function to witness a
/// non-`async` protocol requirement. So a conformer's `observe()` implementation cannot itself
/// `await` into a separate `actor` state machine. Instead this type is a plain, lock-protected
/// class: safe because every mutating call happens either (a) from within the owning `SiteRuntime`
/// actor's isolated methods — already mutually exclusive with each other by actor semantics, since an
/// actor runs at most one synchronous stretch of its own code at a time — or (b) from
/// `AsyncStream`'s `onTermination` callback, the one path that genuinely runs off any actor's
/// isolation (fired by the stream's own machinery when a consumer stops iterating). The lock
/// reconciles (b) with (a) without requiring conformers to hop back onto their own actor just to
/// remove a defunct observer.
///
/// ## The generation guard
///
/// `start()`/`stop()` are `async`, and every conformer is an actor — reentrant at each `await` — so a
/// second `start()`/`stop()` call can run to completion (including its own teardown) while an earlier
/// one is still suspended (e.g. inside a container/sandbox control call). `beginAttempt()` /
/// `beginStarting(siteID:)` hand the caller a generation number — its ticket for checking, via
/// `isCurrent(_:)` or `settle(gen:to:)`, whether it has since been superseded. A superseded caller
/// must tear down whatever *it* created, because the superseding call's own teardown ran before this
/// attempt's bookkeeping (e.g. `activeSiteID`) existed for it to find.
public final class SiteRuntimeStateMachine: @unchecked Sendable {
    private let lock = NSLock()
    private var current: SiteRuntimeState = .idle
    private var observers: [UUID: AsyncStream<SiteRuntimeState>.Continuation] = [:]
    private var generation = 0

    /// Starts at `.idle`, generation 0 — each owning runtime creates exactly one at init.
    public init() {}

    /// The current lifecycle state.
    public var state: SiteRuntimeState {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    /// The current generation, without bumping it — for callers (e.g.
    /// `LocalContainerSiteRuntime.persistEdit`) that need to snapshot "which attempt is this" up
    /// front and later confirm, via `isCurrent(_:)`, that nothing superseded it in between.
    public var currentGeneration: Int {
        lock.lock(); defer { lock.unlock() }
        return generation
    }

    /// The number of currently-registered observers. Test-only diagnostic (no production caller
    /// needs this), used to verify that a cancelled/finished consumer's observer is actually
    /// unregistered rather than leaking.
    public var observerCount: Int {
        lock.lock(); defer { lock.unlock() }
        return observers.count
    }

    /// Registers a new observer, replaying the current state immediately (every conformer's prior
    /// behavior). The returned stream removes its observer automatically when its consumer stops
    /// iterating (cancellation, `break`, deinit).
    public func observe() -> AsyncStream<SiteRuntimeState> {
        let (stream, continuation) = AsyncStream<SiteRuntimeState>.makeStream(bufferingPolicy: .unbounded)
        let id = UUID()
        lock.lock()
        observers[id] = continuation
        let snapshot = current
        lock.unlock()
        continuation.onTermination = { [weak self] _ in self?.removeObserver(id) }
        continuation.yield(snapshot)
        return stream
    }

    /// Bumps and returns the new generation — the caller's ticket for `isCurrent`/`settle`.
    @discardableResult
    public func beginAttempt() -> Int {
        lock.lock(); defer { lock.unlock() }
        generation += 1
        return generation
    }

    /// `beginAttempt()` plus the `.starting(siteID:)` transition. `setState` dedups against the
    /// current value, so re-entering `.starting(siteID:)` for the same site (Restart while already
    /// `.starting` — the "wedged boot" case that command exists for) would otherwise be silently
    /// dropped: observers never see a change, so the progress bar stays frozen on the superseded
    /// attempt. This forces a transient `.idle` first, but only in that specific case — `.ready`,
    /// `.failed`, and `.idle` already differ from the new `.starting` value and don't need it.
    @discardableResult
    public func beginStarting(siteID: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        generation += 1
        if case .starting(let existingSiteID) = current, existingSiteID == siteID {
            applyLocked(.idle)
        }
        applyLocked(.starting(siteID: siteID))
        return generation
    }

    /// Whether `gen` is still the current attempt — i.e. no later `start()`/`stop()` has bumped the
    /// generation since. Callers check this after every suspension point to detect supersession.
    public func isCurrent(_ gen: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return gen == generation
    }

    /// Applies `state` only if `gen` is still current; a superseded caller's result is dropped
    /// instead of clobbering whatever the superseding call already settled to.
    public func settle(gen: Int, to state: SiteRuntimeState) {
        lock.lock(); defer { lock.unlock() }
        guard gen == generation else { return }
        applyLocked(state)
    }

    /// Unconditional state transition (still dedup'd against `current`), for conformers whose
    /// `start()`/`stop()` never race (e.g. `UnavailableSiteRuntime`, which settles synchronously)
    /// and so need no generation guard.
    public func setState(_ state: SiteRuntimeState) {
        lock.lock(); defer { lock.unlock() }
        applyLocked(state)
    }

    // MARK: - Internals (caller must hold `lock`)

    private func applyLocked(_ state: SiteRuntimeState) {
        guard state != current else { return }
        current = state
        for continuation in observers.values { continuation.yield(state) }
    }

    private func removeObserver(_ id: UUID) {
        lock.lock(); defer { lock.unlock() }
        observers[id] = nil
    }
}
