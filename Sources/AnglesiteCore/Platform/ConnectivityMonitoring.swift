import Foundation

/// Portable connectivity seam used by the local-first publish queue. A monitor reports the
/// initial state and subsequent transitions until `stop()`.
public protocol ConnectivityMonitoring: Sendable {
    /// Begins monitoring, delivering the initial reachability and every subsequent transition
    /// to `onChange`. Callbacks may arrive on an arbitrary queue — the publish queue hops back
    /// to its own actor, so implementations don't need to promise a delivery context.
    func start(onChange: @escaping @Sendable (Bool) -> Void)
    /// Stops monitoring; no further callbacks are delivered after it returns.
    func stop()
}

/// Compile-time factory for the platform's connectivity monitor, keeping the `#if` selection
/// here in `Platform/` rather than at each call site.
public enum PlatformConnectivityMonitor {
    /// Returns `NWConnectivityMonitor` where Network.framework exists, otherwise
    /// ``AssumedOnlineConnectivityMonitor``.
    public static func make() -> any ConnectivityMonitoring {
        #if canImport(Network)
        NWConnectivityMonitor()
        #else
        AssumedOnlineConnectivityMonitor()
        #endif
    }
}

/// Platforms without Network.framework still get deterministic foreground publishing. Their
/// native connectivity monitor is supplied by the cross-platform port rather than guessed here.
public final class AssumedOnlineConnectivityMonitor: ConnectivityMonitoring, @unchecked Sendable {
    /// Creates the assume-online fallback. Stateless.
    public init() {}
    /// Reports online once, synchronously, and never fires again — the publish queue then
    /// behaves as plain foreground publishing with no offline deferral.
    public func start(onChange: @escaping @Sendable (Bool) -> Void) { onChange(true) }
    /// No-op — nothing was started.
    public func stop() {}
}

#if canImport(Network)
import Network

/// Production `ConnectivityMonitoring` backed by Network.framework's `NWPathMonitor`. "Online"
/// means the current path's status is `.satisfied` — interface-level reachability, not proof a
/// particular deploy endpoint will answer; the publish queue still handles request failures.
public final class NWConnectivityMonitor: ConnectivityMonitoring, @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "io.dwk.anglesite.connectivity")
    private let lock = NSLock()
    private var running = false

    /// Creates an idle monitor; nothing runs until `start(onChange:)`.
    public init() {}

    /// Starts the path monitor, delivering updates (including the initial state) on a private
    /// queue. The `running` guard makes a second `start` while live a no-op rather than
    /// re-arming `NWPathMonitor`, which does not support being started twice.
    public func start(onChange: @escaping @Sendable (Bool) -> Void) {
        lock.lock()
        guard !running else { lock.unlock(); return }
        running = true
        lock.unlock()
        monitor.pathUpdateHandler = { path in onChange(path.status == .satisfied) }
        monitor.start(queue: queue)
    }

    /// Cancels the path monitor and clears its handler so no queued update fires afterwards.
    /// Idempotent; a stopped `NWPathMonitor` cannot be restarted, matching the guard in
    /// `start(onChange:)`.
    public func stop() {
        lock.lock()
        guard running else { lock.unlock(); return }
        running = false
        lock.unlock()
        monitor.pathUpdateHandler = nil
        monitor.cancel()
    }
}
#endif
