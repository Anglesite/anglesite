import Foundation

/// Coordinates exclusive access to the process-wide `CLOUDFLARE_API_TOKEN` env var between two
/// groups of `AnglesiteAppTests` tests that want incompatible things from it and can run
/// concurrently in the same `swift test` process (Swift Testing only serializes tests *within* a
/// `.serialized` suite, never across suites):
///
/// - "Setters" (`DomainConfigAuditModelTests`, `OnionRoutingModelTests`) want the var **set** to a
///   fixed value. Any number of setters can hold that state at once — their goal doesn't conflict.
/// - "Clearers" (four tests in `DeployModelTests`) want the var **unset**, to exercise the
///   `hasUsableToken()` "no token" fallback path directly. That's exclusive of any setter, and of
///   another clearer, since only one desired value for the var can be live at a time.
///
/// This is a readers/writer problem — setters are the readers, clearers are the writer — so
/// `claimSet()`/`claimClear()` are `async` and suspend until the requested state is safe to hold,
/// via a continuation-based waiter queue. This type is an `actor` (not a class guarded by an
/// `NSLock`, as it was before #1349): every access to `mode`/`setWaiters`/`clearWaiters` is
/// already serialized by actor isolation, so there's no lock to acquire and nothing here ever
/// blocks an OS thread. That matters because Swift Testing runs on the finite cooperative thread
/// pool — a blocking primitive (`NSLock.lock()`, `NSCondition.wait()`, …) called from inside async
/// test code, even briefly, risks starving that pool under contention, which is exactly the
/// failure mode #1349 investigated. Release is synchronous by design: `deinit` can't `await`, and
/// neither can a Swift `defer` body, so every caller does
///
/// ```swift
/// let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
/// defer { cfToken.release() }
/// ```
///
/// `release()` hands off to the actor via a detached `Task`, so the actual state transition (and
/// any waiter it wakes) may complete a moment after `release()` returns rather than synchronously
/// with it. That's invisible to callers: the next claimer always `await`s its own `claimSet()`/
/// `claimClear()` and is correctly suspended until that transition has actually happened, however
/// long it takes.
actor CloudflareAPITokenTestEnvironment {
    static let shared = CloudflareAPITokenTestEnvironment()

    /// A held claim on the env var. `release()` is synchronous so it can run from a `defer` block.
    struct Token: Sendable {
        fileprivate let releaseAction: @Sendable () -> Void
        func release() { releaseAction() }
    }

    private enum Mode {
        case idle
        case set(holders: Int)
        case cleared
    }

    private var mode: Mode = .idle
    private var previousValue: String?
    private var setWaiters: [CheckedContinuation<Void, Never>] = []
    private var clearWaiters: [CheckedContinuation<Void, Never>] = []

    private init() {}

    /// Claims the var in the "set" state. Suspends while a clearer holds exclusive "cleared" state.
    func claimSet(value: String = "test-token") async -> Token {
        while true {
            if case .cleared = mode {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    setWaiters.append(continuation)
                }
                continue
            }
            switch mode {
            case .idle:
                previousValue = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]
                setenv("CLOUDFLARE_API_TOKEN", value, 1)
                mode = .set(holders: 1)
            case .set(let holders):
                mode = .set(holders: holders + 1)
            case .cleared:
                fatalError("unreachable: handled above")
            }
            return Token { [weak self] in
                guard let self else { return }
                Task { await self.releaseSet() }
            }
        }
    }

    /// Claims the var in the exclusive "cleared" state. Suspends while any setter holds "set", or
    /// another clearer holds "cleared".
    func claimClear() async -> Token {
        while true {
            if case .idle = mode {
                previousValue = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]
                unsetenv("CLOUDFLARE_API_TOKEN")
                mode = .cleared
                return Token { [weak self] in
                    guard let self else { return }
                    Task { await self.releaseClear() }
                }
            }
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                clearWaiters.append(continuation)
            }
        }
    }

    private func releaseSet() {
        guard case .set(let holders) = mode else {
            assertionFailure("releaseSet() called without a matching claimSet()")
            return
        }
        if holders > 1 {
            mode = .set(holders: holders - 1)
            return
        }
        restoreEnvAndGoIdle()
    }

    private func releaseClear() {
        guard case .cleared = mode else {
            assertionFailure("releaseClear() called without a matching claimClear()")
            return
        }
        restoreEnvAndGoIdle()
    }

    /// Restores the env var to whatever it was before the just-released claim, then wakes
    /// whichever waiters can now proceed: a clearer first (exclusive, so at most one), otherwise
    /// every waiting setter (mutually compatible).
    private func restoreEnvAndGoIdle() {
        if let previousValue {
            setenv("CLOUDFLARE_API_TOKEN", previousValue, 1)
        } else {
            unsetenv("CLOUDFLARE_API_TOKEN")
        }
        mode = .idle
        let toResume: [CheckedContinuation<Void, Never>]
        if !clearWaiters.isEmpty {
            toResume = [clearWaiters.removeFirst()]
        } else if !setWaiters.isEmpty {
            toResume = setWaiters
            setWaiters.removeAll()
        } else {
            toResume = []
        }
        for continuation in toResume {
            continuation.resume()
        }
    }
}
