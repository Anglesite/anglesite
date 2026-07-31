import Foundation

/// Serializes `astro build` runs against the shared `Resources/Template/` working tree.
///
/// Multiple render-smoke suites (`PersonalTypeRenderSmokeTests`, `FeedsRenderSmokeTests`, …)
/// each build the *same* template directory and `rm -rf dist` around their build. Swift Testing
/// runs suites in parallel, so without coordination one suite's `rm -rf dist` deletes another's
/// in-flight output and that build fails. This actor gives those builds mutual exclusion: each
/// wraps its build in `TemplateBuildSerializer.shared.serialize { … }` so only one runs at a time.
///
/// It is a genuine async lock (not just an actor method — actor reentrancy would let calls
/// interleave at the build's `await`), implemented with a one-slot gate and a FIFO waiter queue.
/// A waiter whose task is cancelled drains itself from the queue and throws `CancellationError`,
/// so a cancelled/timed-out test never wedges the lock for the suites behind it.
public actor TemplateBuildSerializer {
    /// The process-wide instance every render-smoke suite serializes through — mutual exclusion
    /// only works if all suites share the same lock.
    public static let shared = TemplateBuildSerializer()

    private struct Waiter {
        let id: UUID
        let continuation: CheckedContinuation<Void, Error>
    }

    private var locked = false
    private var waiters: [Waiter] = []

    /// Public so a test can construct a private serializer to exercise the lock itself;
    /// production test suites use ``shared``.
    public init() {}

    private func lock() async throws {
        if !locked {
            locked = true
            return
        }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await self.enqueue(id: id)
        } onCancel: {
            Task { await self.drainCancelled(id) }
        }
    }

    /// Park the caller until granted the lock (resumed by `unlock`) or cancelled (resumed by
    /// `drainCancelled`). Resumes immediately if cancellation already happened — the `onCancel`
    /// handler runs only after this synchronous append, so it could otherwise miss the waiter.
    private func enqueue(id: UUID) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            if Task.isCancelled {
                continuation.resume(throwing: CancellationError())
                return
            }
            waiters.append(Waiter(id: id, continuation: continuation))
        }
    }

    private func drainCancelled(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
        let waiter = waiters.remove(at: index)
        waiter.continuation.resume(throwing: CancellationError())
    }

    private func unlock() {
        if waiters.isEmpty {
            locked = false
        } else {
            waiters.removeFirst().continuation.resume()
        }
    }

    /// Run `body` while holding the shared template-build lock; other callers wait their turn.
    /// Throws `CancellationError` (without running `body`) if the task is cancelled while waiting.
    public func serialize<T>(_ body: () async throws -> T) async throws -> T {
        try await lock()
        defer { unlock() }
        return try await body()
    }
}
