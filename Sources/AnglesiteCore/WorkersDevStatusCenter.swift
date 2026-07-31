import Foundation

/// AnglesiteCore-visible mirror of the container layer's internal `GuestProcessSupervisor.State`
/// (#699) — what a `LocalContainerControl.startWorkersDev(…onState:)` callback delivers. Kept
/// separate from `WorkersDevStatus` below because the supervisor doesn't know the proxied URL;
/// `LocalContainerSiteRuntime` composes the two.
public enum WorkersDevProcessState: Sendable, Equatable {
    /// The wrangler-dev process is up.
    case running
    /// The supervisor is relaunching after a crash; `attempt` counts restarts for backoff/UI.
    case restarting(attempt: Int)
    /// The process exited and the supervisor isn't bringing it back (deliberate stop).
    case stopped
    /// The supervisor gave up; `reason` is the diagnostic surfaced to the Debug Pane.
    case failed(reason: String)
}

/// One site's local wrangler-dev session status as shown in the Debug Pane (#699).
public enum WorkersDevStatus: Sendable, Equatable {
    /// The session is being brought up — shown before the supervisor reports anything.
    case starting
    /// `url` is nil only in the brief window between the supervisor reporting `.running` and
    /// `startWorkersDev` returning the proxied URL.
    case running(url: URL?)
    /// The supervisor is relaunching after a crash; `attempt` mirrors
    /// `WorkersDevProcessState.restarting`.
    case restarting(attempt: Int)
    /// The session is dead; `reason` is shown in the Debug Pane row.
    case failed(reason: String)
}

/// One Debug Pane row: a site's wrangler-dev session and its current status.
public struct WorkersDevSession: Sendable, Equatable, Identifiable {
    /// `Identifiable` conformance — a site has at most one dev session, so `siteID` is the row
    /// identity.
    public var id: String { siteID }
    /// The owning site's stable id.
    public let siteID: String
    /// The site's display name, denormalized into the row so the Debug Pane needs no site lookup.
    public let displayName: String
    /// The session's current status.
    public let status: WorkersDevStatus

    /// Memberwise creation — normally produced by `WorkersDevStatusCenter.update`.
    public init(siteID: String, displayName: String, status: WorkersDevStatus) {
        self.siteID = siteID
        self.displayName = displayName
        self.status = status
    }
}

/// Central fan-out for local wrangler-dev session status, mirroring `LogCenter`'s shape: per-site
/// runtimes publish, the (app-global) Debug Pane subscribes. Latest state per site; a removed
/// site's row disappears. Subscribers receive the full ordered snapshot on every change — the
/// population is "open site windows with active workers" (single digits), so full snapshots keep
/// the SwiftUI side a dumb ForEach.
public actor WorkersDevStatusCenter {
    /// Shared instance used by production wiring. Tests build their own.
    public static let shared = WorkersDevStatusCenter()

    /// Handle returned by `subscribe()` — same contract as `LogCenter.Subscription`: `cancel()`
    /// finishes the continuation so a `for await` consumer unblocks.
    public struct Subscription: Sendable {
        /// The full ordered session snapshot, re-yielded on every change (see the actor doc for
        /// why snapshots rather than deltas).
        public let stream: AsyncStream<[WorkersDevSession]>
        private let continuation: AsyncStream<[WorkersDevSession]>.Continuation

        init(stream: AsyncStream<[WorkersDevSession]>, continuation: AsyncStream<[WorkersDevSession]>.Continuation) {
            self.stream = stream
            self.continuation = continuation
        }

        /// Ends the subscription. The iterator returns `nil` on its next `next()`, the for-await
        /// loop exits, and the center drops the registration via `onTermination`.
        public func cancel() {
            continuation.finish()
        }
    }

    private var sessions: [String: WorkersDevSession] = [:]
    private var subscribers: [UUID: AsyncStream<[WorkersDevSession]>.Continuation] = [:]

    /// Creates an empty center — public so tests get isolated instances instead of sharing
    /// ``shared``'s state.
    public init() {}

    /// Publishes a site's latest session state (insert-or-replace) and broadcasts the new
    /// snapshot to every subscriber.
    public func update(siteID: String, displayName: String, status: WorkersDevStatus) {
        sessions[siteID] = WorkersDevSession(siteID: siteID, displayName: displayName, status: status)
        broadcast()
    }

    /// Drops a site's row (e.g. its window closed) and broadcasts — a no-op, with no broadcast,
    /// when the site had no session, so repeated teardown paths don't spam subscribers.
    public func remove(siteID: String) {
        guard sessions.removeValue(forKey: siteID) != nil else { return }
        broadcast()
    }

    /// Current sessions, sorted by display name (then siteID) for a stable row order.
    public func snapshot() -> [WorkersDevSession] {
        sessions.values.sorted {
            ($0.displayName, $0.siteID) < ($1.displayName, $1.siteID)
        }
    }

    /// Subscribes to session changes. The current snapshot is replayed as the first element, so a
    /// Debug Pane opened mid-session shows existing rows without a separate `snapshot()` call.
    public func subscribe() -> Subscription {
        let (stream, continuation) = AsyncStream<[WorkersDevSession]>.makeStream(bufferingPolicy: .unbounded)
        let id = UUID()
        subscribers[id] = continuation
        continuation.yield(snapshot())
        continuation.onTermination = { [weak self] _ in
            guard let self else { return }
            Task { await self.removeSubscriber(id) }
        }
        return Subscription(stream: stream, continuation: continuation)
    }

    /// Number of live subscribers. Exposed for tests; not part of the public contract.
    public func subscriberCount() -> Int {
        subscribers.count
    }

    private func broadcast() {
        let ordered = snapshot()
        for continuation in subscribers.values {
            continuation.yield(ordered)
        }
    }

    private func removeSubscriber(_ id: UUID) {
        subscribers[id] = nil
    }
}
