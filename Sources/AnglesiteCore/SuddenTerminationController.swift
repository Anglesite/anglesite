import Foundation
#if canImport(os)
import os
#endif

/// Process-wide reference counting for work that must finish before macOS may suddenly terminate
/// Anglesite. Callers retain the returned lease for exactly as long as their critical state exists;
/// releasing (or deinitializing) the last lease re-enables sudden termination.
public final class SuddenTerminationController: @unchecked Sendable {
    /// The process-wide instance backed by the real `ProcessInfo` sudden-termination counter.
    /// Use this in app code — a second instance would keep its own lease count and could
    /// re-enable sudden termination while another instance still holds leases.
    public static let shared = SuddenTerminationController()
#if canImport(os)
    private static let logger = Logger(
        subsystem: "io.dwk.anglesite",
        category: "SuddenTerminationController"
    )
#endif

    /// One held reference to "don't suddenly terminate yet." Releasing is idempotent and also
    /// happens automatically on `deinit`, so a lease dropped on an error path (or captured by a
    /// cancelled task) can never permanently pin sudden termination off.
    public final class Lease: @unchecked Sendable {
        private let lock = NSLock()
        private var controller: SuddenTerminationController?

        fileprivate init(controller: SuddenTerminationController) {
            self.controller = controller
        }

        /// Releases this lease once. Repeated calls are harmless.
        public func release() {
            lock.lock()
            let controller = self.controller
            self.controller = nil
            lock.unlock()
            controller?.releaseLease()
        }

        deinit {
            release()
        }
    }

    private let lock = NSLock()
    private let disable: @Sendable () -> Void
    private let enable: @Sendable () -> Void
    private var leaseCount = 0

    /// Creates a controller wired to the real `ProcessInfo` disable/enable calls (no-ops off
    /// macOS). Prefer ``shared`` in app code — see its note on why a second instance is unsafe.
    public convenience init() {
        self.init(
            disable: { SuddenTerminationController.disableProcessSuddenTermination() },
            enable: { SuddenTerminationController.enableProcessSuddenTermination() }
        )
    }

    /// Closures are injectable so the balancing invariant can be tested without changing the test
    /// runner's own sudden-termination state.
    public init(
        disable: @escaping @Sendable () -> Void,
        enable: @escaping @Sendable () -> Void
    ) {
        self.disable = disable
        self.enable = enable
    }

    /// The number of currently outstanding leases — exposed for tests asserting the balancing
    /// invariant; sudden termination is disabled exactly while this is non-zero.
    public var activeLeaseCount: Int {
        lock.withLock { leaseCount }
    }

    /// Takes out a lease, disabling sudden termination if this is the first outstanding one.
    /// Hold the returned ``Lease`` for exactly as long as the critical state exists — its
    /// `release()` (or `deinit`) balances this call.
    public func acquire() -> Lease {
        lock.lock()
        if leaseCount == 0 {
            disable()
        }
        leaseCount += 1
        lock.unlock()
        return Lease(controller: self)
    }

    private func releaseLease() {
        lock.lock()
        guard leaseCount > 0 else {
            lock.unlock()
#if canImport(os)
            Self.logger.fault("Ignoring an unbalanced sudden-termination lease release")
#endif
            assertionFailure("Sudden-termination lease count became unbalanced")
            return
        }
        leaseCount -= 1
        let shouldEnable = leaseCount == 0
        if shouldEnable {
            enable()
        }
        lock.unlock()
    }

    private static func disableProcessSuddenTermination() {
        #if os(macOS)
        ProcessInfo.processInfo.disableSuddenTermination()
        #endif
    }

    private static func enableProcessSuddenTermination() {
        #if os(macOS)
        ProcessInfo.processInfo.enableSuddenTermination()
        #endif
    }
}
