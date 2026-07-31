import Foundation
import AnglesiteCore

/// Robust startup waiting for the MCP / apply-edit end-to-end tests, which spawn the *real* plugin
/// Node server. Cold startup is fast (<1 s) when healthy, but a broken plugin install — e.g. a
/// missing native dep like `sharp`, which `server/apply-edit-dispatcher.mjs` imports eagerly — makes
/// the server crash on load before it ever listens. Polling the connect/handshake alone can't tell
/// "still booting" from "already dead", so it would burn the entire timeout budget and then report
/// an opaque transport error (`.sessionLost`) instead of the real crash.
///
/// `awaitReady` races the readiness operation against the supervised process's exit: if the process
/// dies first, it throws `ServerExited` carrying the captured stderr, surfacing the real cause
/// immediately.
public enum E2EServer {
    /// The spawned server process exited before it became ready. Carries the captured stderr so the
    /// real failure (e.g. `Cannot find package 'sharp'`) is visible in the test output.
    public struct ServerExited: Error, CustomStringConvertible {
        /// How the process ended (exit code vs. signal), from the supervisor.
        public let reason: ProcessSupervisor.ExitReason
        /// Everything the process wrote to stderr before dying; empty if nothing was captured.
        public let stderr: String

        /// Memberwise initializer; `awaitReady` constructs this when the death task wins the race.
        public init(reason: ProcessSupervisor.ExitReason, stderr: String) {
            self.reason = reason
            self.stderr = stderr
        }

        /// Multi-line message embedding the captured stderr, so the real crash cause lands
        /// directly in the test failure output.
        public var description: String {
            """
            MCP server process exited (\(reason)) before becoming ready.
            --- captured stderr ---
            \(stderr.isEmpty ? "(no stderr captured)" : stderr)
            """
        }
    }

    /// The readiness budget elapsed while the server was still running (it just never became ready).
    /// Distinct from `ServerExited`: the process is alive here, so there is no exit reason and no
    /// crash stderr to report — conflating the two (e.g. `ServerExited(reason: .terminated, …)`)
    /// would send a reader chasing a phantom signal kill.
    public struct ServerTimedOut: Error, CustomStringConvertible {
        /// The readiness budget that elapsed, in seconds.
        public let timeout: TimeInterval

        /// Memberwise initializer; `awaitReady` constructs this when the timeout task wins the race.
        public init(timeout: TimeInterval) {
            self.timeout = timeout
        }

        /// One-line message noting the process was still alive — the detail that distinguishes
        /// this from a crash.
        public var description: String {
            "MCP server did not become ready within \(timeout)s (process still running)."
        }
    }

    /// Records which of the racing tasks (readiness / death / timeout) settled first. Exactly one
    /// `claim()` returns `true`; the losers see `false` and bow out without throwing. This replaces a
    /// `Task.isCancelled` check, which is timing-dependent: when the process exits at the same instant
    /// readiness succeeds, `group.cancelAll()` hasn't propagated yet, so the death task would observe
    /// `isCancelled == false` and throw a spurious `ServerExited` even though readiness won.
    private actor Outcome {
        private var settled = false
        func claim() -> Bool {
            if settled { return false }
            settled = true
            return true
        }
    }

    /// Run `readiness` (typically a connect/handshake poll), but abort the moment the supervised
    /// `handle` process exits — throwing `ServerExited` with the captured stderr instead of letting
    /// the poll spin until `timeout`. The budget can therefore be generous (real cold starts vary)
    /// without making a *dead* server slow to diagnose: it fails in the time the process takes to
    /// crash, not the time the budget allows.
    ///
    /// `InProcessBackend` drains the stdout/stderr pipes before resuming exit waiters, so the stderr
    /// snapshot taken after `waitForExit` is guaranteed to include the crash output.
    public static func awaitReady(
        handle: ProcessSupervisor.Handle,
        supervisor: ProcessSupervisor,
        logCenter: LogCenter,
        timeout: TimeInterval = 60,
        readiness: @Sendable @escaping () async throws -> Void
    ) async throws {
        let outcome = Outcome()
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                try await readiness()
                // Mark readiness as the winner if it got here first; if the death/timeout task
                // already claimed the outcome, this is a no-op and we just return success.
                _ = await outcome.claim()
            }

            group.addTask {
                let reason = await supervisor.waitForExit(handle)
                // Throw only if we won the race. If readiness already claimed the outcome, the
                // process exit is just the cleanup that follows a successful start — not a crash.
                guard await outcome.claim() else { return }
                let stderr = await logCenter.snapshot()
                    .filter { $0.source == handle.source && $0.stream == .stderr }
                    .map(\.text)
                    .joined(separator: "\n")
                throw ServerExited(reason: reason, stderr: stderr)
            }

            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(max(timeout, 0) * 1_000_000_000))
                guard await outcome.claim() else { return }
                throw ServerTimedOut(timeout: timeout)
            }

            defer { group.cancelAll() }
            // First task to finish decides the outcome: readiness success returns, a crash or
            // timeout throws. The `Outcome` gate guarantees the loser tasks can't also throw.
            try await group.next()
        }
    }
}
