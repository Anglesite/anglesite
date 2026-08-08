import Foundation

/// Coordinates exclusive access to the process-wide `CLOUDFLARE_API_TOKEN` env var between the
/// `AnglesiteCoreTests` suites that read it via `CloudflareAPICredentials.resolve()` (#1211) and
/// can run concurrently in the same `swift test` process (Swift Testing only serializes tests
/// *within* a `.serialized` suite, never across suites): `CloudflareAPICredentialsTests` (one
/// "setter" case wants it set to a specific value; the rest want it cleared), and
/// `InboxSubmissionSyncTests`/`ReceivedInteractionSyncTests` ("clearer" cases exercising the
/// "no token available" fallback path). A bare `setenv`/`unsetenv` in any of these can otherwise
/// race a concurrent one in another suite, producing a spurious pass/fail in whichever loses the
/// race — the same class of cross-suite hazard `AnglesiteAppTests`' own
/// `CloudflareAPITokenTestEnvironment` was built to eliminate for its target, just not shared
/// across the module boundary (each test target gets its own instance of this coordinator; they
/// don't need to coordinate with each other since no other target's tests share this file).
///
/// This is a readers/writer problem — setters are the readers, clearers are the writer — so
/// `claimSet()`/`claimClear()` are `async` and suspend until the requested state is safe to hold,
/// via a continuation-based waiter queue rather than by blocking the calling thread. Swift Testing
/// runs on a cooperative thread pool; a blocking wait (e.g. `NSCondition.wait()`) inside an async
/// test body risks starving it. Release is synchronous by design: `deinit` can't `await`, and
/// neither can a Swift `defer` body, so every caller does
///
/// ```swift
/// let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
/// defer { cfToken.release() }
/// ```
final class CloudflareAPITokenTestEnvironment: @unchecked Sendable {
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

    private let lock = NSLock()
    private var mode: Mode = .idle
    private var previousValue: String?
    private var setWaiters: [CheckedContinuation<Void, Never>] = []
    private var clearWaiters: [CheckedContinuation<Void, Never>] = []

    private init() {}

    /// Claims the var in the "set" state. Suspends while a clearer holds exclusive "cleared" state.
    func claimSet(value: String = "test-token") async -> Token {
        while true {
            lock.lock()
            if case .cleared = mode {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    setWaiters.append(continuation)
                    lock.unlock()
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
            lock.unlock()
            return Token { [weak self] in self?.releaseSet() }
        }
    }

    /// Claims the var in the exclusive "cleared" state. Suspends while any setter holds "set", or
    /// another clearer holds "cleared".
    func claimClear() async -> Token {
        while true {
            lock.lock()
            if case .idle = mode {
                previousValue = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]
                unsetenv("CLOUDFLARE_API_TOKEN")
                mode = .cleared
                lock.unlock()
                return Token { [weak self] in self?.releaseClear() }
            }
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                clearWaiters.append(continuation)
                lock.unlock()
            }
        }
    }

    private func releaseSet() {
        lock.lock()
        guard case .set(let holders) = mode else {
            lock.unlock()
            assertionFailure("releaseSet() called without a matching claimSet()")
            return
        }
        if holders > 1 {
            mode = .set(holders: holders - 1)
            lock.unlock()
            return
        }
        restoreEnvAndGoIdle()
    }

    private func releaseClear() {
        lock.lock()
        guard case .cleared = mode else {
            lock.unlock()
            assertionFailure("releaseClear() called without a matching claimClear()")
            return
        }
        restoreEnvAndGoIdle()
    }

    /// Must be called with `lock` held; unlocks before returning. Restores the env var to whatever
    /// it was before the just-released claim, then wakes whichever waiters can now proceed: a
    /// clearer first (exclusive, so at most one), otherwise every waiting setter (mutually
    /// compatible). Continuations are only resumed after `lock` is released, so a waiter that
    /// immediately re-claims on resume never re-enters this type while it's still locked.
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
        lock.unlock()
        for continuation in toResume {
            continuation.resume()
        }
    }
}
