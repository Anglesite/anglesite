import Foundation

/// Thin wrapper around `ProcessInfo`'s activity-assertion API (macOS-only) so long-running,
/// user-initiated work — first-boot container provisioning in particular — isn't silently
/// suspended by App Nap / idle-sleep throttling when the app is occluded, e.g. the screen locks
/// mid-boot (#773). A user who creates a site and walks away should come back to a completed (or
/// cleanly failed) boot, not a "Building site…" that silently made no progress for 40 minutes.
///
/// Each `begin(reason:)` call acquires its own independent token — unlike
/// `SuddenTerminationController`, there is no shared ref-count to keep balanced; the OS tracks
/// each assertion separately, so two overlapping callers (a superseded and a superseding boot
/// attempt, say) can't clobber each other.
public enum ActivityAssertion {
    /// Holds one assertion. `onRelease` (not a raw `ProcessInfo` token) is what's stored, so tests
    /// can construct a `Lease` directly around a counting closure without ever touching the real
    /// Darwin activity API — faking a bogus token into `endActivity` would be unsafe.
    public final class Lease: @unchecked Sendable {
        private let lock = NSLock()
        private var onRelease: (@Sendable () -> Void)?

        /// `onRelease` runs exactly once — on the first ``release()`` call, or in `deinit` if
        /// the caller drops the lease without releasing. Public so tests can construct a lease
        /// around a counting closure (see the type doc for why the raw `ProcessInfo` token is
        /// never what's stored).
        public init(onRelease: @escaping @Sendable () -> Void) {
            self.onRelease = onRelease
        }

        /// Ends this assertion once. Repeated calls are harmless.
        public func release() {
            lock.lock()
            let action = onRelease
            onRelease = nil
            lock.unlock()
            action?()
        }

        deinit { release() }
    }

    /// Begins an activity assertion with `reason` (surfaced in Activity Monitor's "reason" column
    /// for the process). No-op off macOS — the assertion API doesn't exist there, and there's no
    /// App Nap/occlusion throttling to route around on the platforms `#os(macOS)` excludes.
    ///
    /// `.userInitiated` requests the system not throttle this work for App Nap purposes;
    /// `.idleSystemSleepDisabled` additionally covers the "walked away and the *system* idle-sleeps"
    /// case, not just app-level occlusion throttling — both apply to "user created a site and the
    /// screen locked mid-boot."
    public static func begin(reason: String) -> Lease {
        #if os(macOS)
        let token = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .idleSystemSleepDisabled],
            reason: reason
        )
        return Lease(onRelease: { ProcessInfo.processInfo.endActivity(token) })
        #else
        return Lease(onRelease: {})
        #endif
    }
}
