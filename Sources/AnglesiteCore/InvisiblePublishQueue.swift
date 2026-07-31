import Foundation

/// Durable, debounced scheduler for the local-first publish pipeline.
///
/// The site's git working tree remains the content source of truth. This queue persists only the
/// fact that the working tree still needs publishing, so an offline edit survives an app restart
/// without duplicating source data in app-owned state.
public actor InvisiblePublishQueue {
    /// The queue's lifecycle, surfaced through the `onStateChange` observer so the UI can
    /// mirror background publish activity without polling the actor.
    public enum State: Sendable, Equatable {
        /// Nothing pending: the working tree is published (or was never edited).
        case idle
        /// An edit landed and the idle window is counting down toward a publish.
        case debouncing
        /// Pending work is parked until connectivity returns; reconnection publishes
        /// immediately (the offline period already served as the debounce).
        case queuedOffline
        /// A publish attempt is running; its ``Result`` decides the next state.
        case publishing
        /// The pre-deploy security gate blocked the publish; mirrors
        /// ``Result/blocked(failureCount:)``. The pending marker persists.
        case blocked(failureCount: Int)
        /// The publish failed; mirrors ``Result/failed(reason:)``. The pending marker persists
        /// so a later edit or retry can drain it.
        case failed(reason: String)
        /// A local prerequisite isn't ready; mirrors ``Result/deferred(reason:)``.
        case deferred(reason: String)
    }

    /// Terminal outcome the injected ``Publisher`` reports for one publish attempt. Every
    /// non-`succeeded` case leaves the durable pending marker in place.
    public enum Result: Sendable, Equatable {
        /// The deploy finished; `url` is the live site. Clears the pending marker — unless an
        /// edit landed mid-publish, in which case the newer working tree is rescheduled.
        case succeeded(url: URL)
        /// The pre-deploy security gate refused the deploy; `failureCount` is the number of
        /// check failures it reported. Distinct from `failed` so the app can route it to the
        /// security-block notification path instead of a generic error.
        case blocked(failureCount: Int)
        /// The attempt failed with a user-presentable reason; the queue stays pending.
        case failed(reason: String)
        /// A local prerequisite such as the container runtime or API token is not ready. The
        /// durable queue remains pending and `retryPending()` may drain it later.
        case deferred(reason: String)
    }

    /// Runs one complete publish of the current working tree and reports its terminal
    /// ``Result``. The queue never inspects site content itself — this closure owns the whole
    /// pipeline (build, security gate, deploy), which is what keeps the queue's persisted
    /// state down to a single "still needs publishing" bit.
    public typealias Publisher = @Sendable () async -> Result
    /// Receives each distinct ``State`` transition (duplicates are suppressed). Invoked from
    /// the actor as transitions happen — hop to the main actor before touching UI.
    public typealias StateObserver = @Sendable (State) -> Void
    /// Debounce timer seam. Production always uses `Task.sleep`; tests can substitute a
    /// manually-triggered gate so the debounce "elapses" only when the test says so, instead of
    /// racing a real timer against actor scheduling under CI load (#762).
    public typealias Sleep = @Sendable (Duration) async throws -> Void

    private struct Record: Codable {
        static let currentVersion = 1

        let version: Int
        let pending: Bool
        let lastEditedAt: Date
    }

    /// Name of the durable pending-marker file, written under the site's app-owned `Config/`
    /// directory (never inside the `Source/` git repo — see the type doc).
    public static let filename = "invisible-publish-queue.json"

    private let recordURL: URL
    private let debounce: Duration
    private let publisher: Publisher
    private let onStateChange: StateObserver?
    private let now: @Sendable () -> Date
    private let sleep: Sleep

    private var state: State = .idle
    private var isOnline = false
    private var isPending = false
    private var generation: UInt64 = 0
    private var lastEditedAt = Date.distantPast
    private var debounceTask: Task<Void, Never>?
    private var publishTask: Task<Void, Never>?

    /// Creates a queue for one site. Call `start(isOnline:)` to load any persisted pending
    /// marker and begin scheduling.
    ///
    /// - Parameters:
    ///   - configDirectory: The site's app-owned `Config/` directory; the pending marker is
    ///     persisted here as ``InvisiblePublishQueue/filename``.
    ///   - debounce: Idle window after the last edit before a publish begins.
    ///   - publisher: The closure that performs an actual publish — see ``Publisher``.
    ///   - onStateChange: Optional observer of state transitions — see ``StateObserver``.
    ///   - now: Clock seam; tests substitute a fixed date to make `lastEditedAt` deterministic.
    ///   - sleep: Debounce timer seam — see ``Sleep``.
    public init(
        configDirectory: URL,
        debounce: Duration = .seconds(3),
        publisher: @escaping Publisher,
        onStateChange: StateObserver? = nil,
        now: @escaping @Sendable () -> Date = { Date.now },
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) }
    ) {
        self.recordURL = configDirectory.appendingPathComponent(Self.filename)
        self.debounce = debounce
        self.publisher = publisher
        self.onStateChange = onStateChange
        self.now = now
        self.sleep = sleep
    }

    /// Loads a pending marker from disk and begins scheduling against the current connectivity.
    public func start(isOnline: Bool) {
        self.isOnline = isOnline
        if let record = loadRecord(), record.version == Record.currentVersion, record.pending {
            isPending = true
            lastEditedAt = record.lastEditedAt
            generation &+= 1
        }
        guard isPending else {
            transition(to: .idle)
            return
        }
        if isOnline {
            scheduleDebounce()
        } else {
            transition(to: .queuedOffline)
        }
    }

    /// Marks the working tree dirty and restarts the idle debounce window.
    public func recordEdit() {
        isPending = true
        generation &+= 1
        lastEditedAt = now()
        persistRecord()

        guard publishTask == nil else { return }
        if isOnline {
            scheduleDebounce()
        } else {
            transition(to: .queuedOffline)
        }
    }

    /// Connectivity updates are idempotent. Reconnection drains a pending queue immediately;
    /// it does not impose another edit debounce because the offline period already supplied one.
    public func setOnline(_ online: Bool) {
        guard online != isOnline else { return }
        isOnline = online
        if !online {
            debounceTask?.cancel()
            debounceTask = nil
            if isPending, publishTask == nil { transition(to: .queuedOffline) }
        } else if isPending, publishTask == nil {
            beginPublish()
        }
    }

    /// Retries a durable item when a non-network prerequisite becomes available (for example,
    /// after the site's container reaches its ready state).
    public func retryPending() {
        guard isPending, isOnline, publishTask == nil else { return }
        beginPublish()
    }

    /// The queue's current lifecycle state.
    public func currentState() -> State { state }
    /// Whether the working tree still needs publishing — stays true while a publish is in
    /// flight, until an attempt succeeds for the latest edit generation.
    public func hasPendingPublish() -> Bool { isPending }

    /// Cancels the debounce and re-persists the pending marker for the next launch.
    ///
    /// Deliberately does *not* cancel an in-flight publish: a real deploy is intentionally
    /// allowed to reach its terminal result, because cancelling the wrapper task would cancel
    /// its child subprocess and leave remote state unclear.
    public func stop() {
        debounceTask?.cancel()
        debounceTask = nil
        if isPending { persistRecord() }
    }

    private func scheduleDebounce() {
        debounceTask?.cancel()
        transition(to: .debouncing)
        let delay = debounce
        debounceTask = Task { [weak self, sleep] in
            do {
                try await sleep(delay)
            } catch {
                return
            }
            await self?.beginPublish()
        }
    }

    private func beginPublish() {
        guard isPending, isOnline, publishTask == nil else { return }
        debounceTask?.cancel()
        debounceTask = nil
        let publishingGeneration = generation
        transition(to: .publishing)
        // Keep the queue alive until the real publish reaches a terminal result, even if its site
        // window closes. `finish` clears `publishTask`, breaking the temporary self/task cycle.
        publishTask = Task { [self, publisher] in
            let result = await publisher()
            finish(result, publishingGeneration: publishingGeneration)
        }
    }

    private func finish(_ result: Result, publishingGeneration: UInt64) {
        publishTask = nil
        switch result {
        case .succeeded:
            if generation == publishingGeneration {
                isPending = false
                try? FileManager.default.removeItem(at: recordURL)
                transition(to: .idle)
            } else {
                // An edit landed while the publish was running. The completed deploy covers the
                // old generation only, so debounce and publish the newer working tree.
                persistRecord()
                if isOnline { scheduleDebounce() } else { transition(to: .queuedOffline) }
            }
        case .blocked(let failureCount):
            persistRecord()
            transition(to: .blocked(failureCount: failureCount))
        case .failed(let reason):
            persistRecord()
            transition(to: .failed(reason: reason))
        case .deferred(let reason):
            persistRecord()
            transition(to: .deferred(reason: reason))
        }
    }

    private func transition(to newState: State) {
        guard state != newState else { return }
        state = newState
        onStateChange?(newState)
    }

    private func persistRecord() {
        let record = Record(version: Record.currentVersion, pending: isPending, lastEditedAt: lastEditedAt)
        guard let data = try? JSONEncoder().encode(record) else { return }
        try? FileManager.default.createDirectory(at: recordURL.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        try? data.write(to: recordURL, options: .atomic)
    }

    private func loadRecord() -> Record? {
        guard let data = try? Data(contentsOf: recordURL) else { return nil }
        return try? JSONDecoder().decode(Record.self, from: data)
    }
}
