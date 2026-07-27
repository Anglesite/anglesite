#if canImport(Darwin)
import Foundation
import AnglesiteSiteModel

/// Narrow seam `SyncScheduler` depends on instead of the concrete `SyncEngine` actor, so this
/// file's debounce/coalescing/trigger policy can be unit-tested against a fake — no real git
/// repository, libgit2 call, or iCloud round-trip needed (#881's "keep the app layer thin, push
/// the testable logic into AnglesiteCore" instruction, mirroring how `TokenOnboarding` was
/// extracted from `DeployModel`).
public protocol SyncEngineProtocol: Sendable {
    func pull(package: AnglesitePackage) async -> SyncEngine.PullResult
    func push(package: AnglesitePackage) async -> SyncEngine.PushResult
    func pendingConflict(package: AnglesitePackage) -> SyncEngine.SyncConflict?
    func acknowledgeConflictResolved(package: AnglesitePackage) async
}

extension SyncEngine: SyncEngineProtocol {}

/// Owns *when* a `.anglesite` package's `SyncEngine` runs, for one open site window (design doc
/// `2026-07-21-icloud-git-sync-design.md`'s "App wiring" paragraph, #881): pull on site open and
/// on every observed `source.bundle` change, and a single debounced/coalesced push after each
/// trigger that can produce new local history — a successful `BackupCommand` auto-commit, a
/// deploy, or the app going to the background.
///
/// **Idle = zero activity.** This actor does nothing on its own: no timer, no polling loop. Every
/// pull or push happens because a caller invoked one of the `…Occurred`/`…Changed` methods below.
/// A site that never changes and is never reopened never touches its `SyncEngine` again after the
/// first `siteOpened()` — matching #881's acceptance criteria ("no sync activity for idle sites").
/// Callers (the app layer) are responsible for only constructing a scheduler for a package that
/// actually lives in iCloud Drive (`ICloudSyncEligibility`) — a plain local package should never
/// get one at all, which is the only way to guarantee it sees zero sync activity, ever.
///
/// **One scheduler per open site window**, matching `SyncEngine`'s own single-caller invariant:
/// nothing here re-enters `engine.pull`/`engine.push` concurrently for the same package.
public actor SyncScheduler {
    /// Coarse status for `SiteWindow`'s toolbar/menu surface (#881: "synced / syncing / waiting
    /// for iCloud / needs attention"). `.idle` is the initial state before the first `siteOpened()`
    /// — a package this scheduler has never touched, including one that was never eligible.
    public enum Status: Sendable, Equatable {
        case idle
        case syncing
        case synced(Date)
        case waitingForICloud
        case needsAttention(SyncEngine.SyncConflict)
        case failed(reason: String)
    }

    public typealias StatusObserver = @Sendable (Status) -> Void
    /// Debounce timer seam — mirrors `InvisiblePublishQueue.Sleep`: production always sleeps for
    /// real, tests substitute a manually-released gate so debounce assertions don't race a live
    /// timer against actor scheduling under CI load (#762's lesson, reapplied here).
    public typealias Sleep = @Sendable (Duration) async throws -> Void

    private let package: AnglesitePackage
    private let engine: any SyncEngineProtocol
    private let pushDebounce: Duration
    private let onStatusChange: StatusObserver?
    private let now: @Sendable () -> Date
    private let sleep: Sleep

    private(set) var status: Status = .idle
    /// Set whenever a push-worthy trigger fires; cleared only once a push actually runs for it.
    /// Lets a trigger that lands *while* a push is already in flight schedule a fresh debounce for
    /// the newer state, instead of being silently dropped (same shape as
    /// `InvisiblePublishQueue.isPending`/`finish`).
    private var pushPending = false
    private var pushDebounceTask: Task<Void, Never>?
    private var pushTask: Task<Void, Never>?

    public init(
        package: AnglesitePackage,
        engine: any SyncEngineProtocol,
        pushDebounce: Duration = .seconds(5),
        onStatusChange: StatusObserver? = nil,
        now: @escaping @Sendable () -> Date = { Date.now },
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) }
    ) {
        self.package = package
        self.engine = engine
        self.pushDebounce = pushDebounce
        self.onStatusChange = onStatusChange
        self.now = now
        self.sleep = sleep
    }

    public func currentStatus() -> Status { status }

    // MARK: - Pull triggers

    /// Runs immediately (no debounce — a user just opened the window and is waiting on it).
    @discardableResult
    public func siteOpened() async -> Status { await runPull() }

    /// Runs immediately: an `NSMetadataQuery`/file-presenter observed `source.bundle` change
    /// while this site's window is open. Also undebounced — the whole point is showing the
    /// incoming edit promptly; `SyncEngine.pull()` itself is already a cheap no-op
    /// (`.upToDate`) on the overwhelmingly common case where the change was this Mac's own push.
    @discardableResult
    public func bundleChanged() async -> Status { await runPull() }

    // MARK: - Push triggers (all debounced + coalesced into a single push)

    /// A `BackupCommand` auto-commit succeeded — there may be new local history to mirror.
    public func backupCompleted() { schedulePush() }

    /// A deploy completed — same reasoning as `backupCompleted()`.
    public func deployCompleted() { schedulePush() }

    /// The app is going to the background (`NSApplication.didResignActiveNotification`). Still a
    /// debounced push (#881's wording), but with no delay: the window may not get another chance
    /// to run before the user switches away for a while, so don't make it wait out the normal
    /// quiescence window first. Still coalesces with any push already in flight or already
    /// scheduled, so backgrounding immediately after a backup doesn't double-push.
    public func appDidBackground() { schedulePush(immediate: true) }

    /// Cancels any pending debounce. An in-flight push (already past the debounce, actually
    /// running) is deliberately left alone — same reasoning as `SiteWindowModel.close()` leaving
    /// an in-flight Deploy/Backup running: its Task retains everything it needs and should reach a
    /// real terminal result rather than being cut off mid-write.
    public func stop() {
        pushDebounceTask?.cancel()
        pushDebounceTask = nil
    }

    // MARK: - Conflict resolution hookup

    /// Re-checks `engine.pendingConflict(package:)` and re-pulls/pushes once the caller has
    /// committed a resolution and called `engine.acknowledgeConflictResolved(package:)` — the
    /// scheduler's status was pinned at `.needsAttention` until this runs.
    @discardableResult
    public func conflictResolved() async -> Status { await runPull() }

    // MARK: - Pull

    private func runPull() async -> Status {
        transition(.syncing)
        let result = await engine.pull(package: package)
        switch result {
        case .upToDate, .fastForwarded, .bootstrapped, .merged, .localAhead:
            transition(.synced(now()))
        case .conflicted(let conflict):
            transition(.needsAttention(conflict))
        case .waitingForICloud:
            transition(.waitingForICloud)
        case .failed(let reason):
            transition(.failed(reason: reason))
        }
        return status
    }

    // MARK: - Push (debounced + coalesced)

    private func schedulePush(immediate: Bool = false) {
        pushPending = true
        pushDebounceTask?.cancel()
        let delay = immediate ? Duration.zero : pushDebounce
        pushDebounceTask = Task { [weak self, sleep] in
            do {
                try await sleep(delay)
            } catch {
                return
            }
            await self?.beginPush()
        }
    }

    private func beginPush() {
        guard pushPending, pushTask == nil else { return }
        pushDebounceTask = nil
        pushPending = false
        transition(.syncing)
        pushTask = Task { [self, engine, package] in
            let result = await engine.push(package: package)
            await finishPush(result)
        }
    }

    private func finishPush(_ result: SyncEngine.PushResult) {
        pushTask = nil
        switch result {
        case .unchanged, .pushed:
            transition(.synced(now()))
        case .pausedForConflict(let branch):
            // Reflect the pause even for a push-only trigger that never itself ran a pull: check
            // the engine's own persisted marker so the UI's "needs attention" state doesn't
            // depend on which trigger happened to fire first.
            if let conflict = engine.pendingConflict(package: package), conflict.branch == branch {
                transition(.needsAttention(conflict))
            } else {
                transition(.failed(reason: "push paused for an unresolved conflict on \(branch)"))
            }
        case .failed(let reason):
            transition(.failed(reason: reason))
        }
        // A trigger landed while this push was in flight — cover the newer state with a fresh
        // (still debounced) push rather than dropping it.
        if pushPending {
            schedulePush()
        }
    }

    private func transition(_ newStatus: Status) {
        guard status != newStatus else { return }
        status = newStatus
        onStatusChange?(newStatus)
    }
}
#endif
