import Foundation
import Containerization

/// Process-wide holder for site VMs that have been paused (not torn down) on window close —
/// see docs/superpowers/plans/2026-07-27-suspend-container-on-window-close.md. Must be a true
/// singleton (like `SharedVmnetNetwork.shared`/`RootfsTemplateCache.shared` in
/// `ContainerizationControl.swift`), NOT owned by a `ContainerizationControl` instance: each
/// `LiveSiteRuntimeFactory.makeRuntime` call constructs a fresh `ContainerizationControl()` (and
/// thus a fresh, per-window `LiveContainers`) every time a site window opens — including
/// reopening the same site after its previous window fully closed — so a paused container
/// recorded anywhere per-window would become unreachable the moment that window's object graph
/// deallocates.
public actor PausedContainerRegistry {
    public static let shared = PausedContainerRegistry()

    /// Each paused VM still reserves its full 2 vCPU / 2GB (`ContainerizationControl.swift:445-446`)
    /// — `pause()` freezes guest execution in place, it does not release the memory
    /// Virtualization.framework allocated at boot. Capped so an unbounded number of backgrounded
    /// site windows can't slowly exhaust host resources; worst case with this cap is
    /// `maxPaused` × 2 vCPU/2GB paused, plus whatever the currently-focused window's own VM costs.
    public static let maxPaused = 2

    public struct Entry: Sendable {
        public let container: LinuxContainer
        public let ext4Artifacts: [URL]
    }

    private var entries: [String: Entry] = [:]
    /// Least-recently-suspended siteID first.
    private var order: [String] = []

    public init() {}

    /// Registers a newly-paused container for `siteID`, evicting (fully tearing down) the
    /// least-recently-suspended entry first if this would exceed `maxPaused`.
    public func register(siteID: String, container: LinuxContainer, ext4Artifacts: [URL]) async {
        if let evictSiteID = Self.siteIDToEvict(order: order, capacity: Self.maxPaused),
           let victim = entries.removeValue(forKey: evictSiteID) {
            order.removeAll { $0 == evictSiteID }
            await Self.teardown(victim, siteID: evictSiteID)
        }
        entries[siteID] = Entry(container: container, ext4Artifacts: ext4Artifacts)
        order.append(siteID)
    }

    /// Removes and returns the paused entry for `siteID`, or `nil` if none is registered (a
    /// site that's never been suspended, or one evicted/torn down since it was).
    public func reclaim(siteID: String) -> Entry? {
        guard let entry = entries.removeValue(forKey: siteID) else { return nil }
        order.removeAll { $0 == siteID }
        return entry
    }

    /// Tears down every currently-paused container — called once, at app quit
    /// (`AppDelegate.applicationShouldTerminate`), so quitting never leaves an orphaned paused VM
    /// or stale ext4 artifact on disk (nothing will ever resume them after the process exits).
    public func teardownAll() async {
        for (siteID, entry) in entries {
            await Self.teardown(entry, siteID: siteID)
        }
        entries = [:]
        order = []
    }

    /// Pure eviction decision, factored out so it's testable without a real `LinuxContainer`: the
    /// least-recently-suspended siteID, once `order` would reach `capacity`, else `nil`.
    static func siteIDToEvict(order: [String], capacity: Int) -> String? {
        order.count >= capacity ? order.first : nil
    }

    /// Tears down one paused entry. The VM may still be genuinely paused (never resumed) —
    /// `LinuxContainer.stop()` requires the underlying VM to be `.running`
    /// (`VZVirtualMachineInstance.stop()`'s own `guard self.state == .running` throws "vm is not
    /// running" otherwise, and a paused VM's `VirtualMachineInstanceState` reads `.unknown`, not
    /// `.running` — `vzStateToInstanceState()` has no `.paused` case, see Task 1's probe finding).
    /// So every paused entry must be resumed before it can be stopped cleanly. Best-effort
    /// throughout (`try?`), matching every other teardown path in `ContainerizationControl.swift`.
    static func teardown(_ entry: Entry, siteID: String) async {
        try? await entry.container.withVirtualMachineInstance { vm in try await vm.resume() }
        try? await entry.container.stop()
        await SharedVmnetNetwork.shared.release(siteID: siteID)
        for url in entry.ext4Artifacts { try? FileManager.default.removeItem(at: url) }
    }
}
