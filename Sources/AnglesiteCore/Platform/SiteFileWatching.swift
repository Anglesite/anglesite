import Foundation

/// Portable seam for watching a site's source tree for changes — seam 2 of the cross-platform
/// port design (docs/superpowers/specs/2026-07-08-cross-platform-swift-port-design.md §5).
///
/// Implementations: `FSEventsFileWatcher` (Darwin, CoreServices FSEvents); `InotifyFileWatcher`
/// (Linux, inotify via Glibc). Windows gets a `ReadDirectoryChangesW` watcher. Platforms without
/// a native implementation yet use `UnavailableFileWatcher`, whose `start` throws immediately —
/// callers already treat a watcher failure as "run without live reindexing" (see
/// `LocalContainerSiteRuntime`), so this degrades capability-flagged rather than silently
/// pretending to watch.
public protocol SiteFileWatching: Sendable {
    /// Begin watching `root`, delivering batches to `onBatch` until `stop()`. Throws if the
    /// underlying watch cannot be established.
    func start(root: URL, onBatch: @escaping @Sendable (FileChangeBatch) -> Void) throws
    /// Stop watching and release platform resources. Must be safe to call whether or not
    /// `start` succeeded (callers tear down unconditionally), and no batches may be delivered
    /// after it returns.
    func stop()
}

/// A debounced batch of filesystem changes under a watched root.
public struct FileChangeBatch: Sendable, Equatable {
    /// Absolute URLs the watcher reported as changed in this batch.
    public let paths: [URL]
    /// The watcher dropped per-file granularity (coalesced bulk event, root moved, or
    /// mount/unmount). Consumers should fall back to a full rebuild rather than per-file updates.
    public let needsFullRescan: Bool

    /// Creates a batch. Public so per-platform watchers and test fakes (not just this module)
    /// can synthesize batches for consumers.
    public init(paths: [URL], needsFullRescan: Bool) {
        self.paths = paths
        self.needsFullRescan = needsFullRescan
    }
}

/// Placeholder watcher for platforms without a native implementation yet. `start` always throws,
/// so callers see the same "watch unavailable" path they already handle for a real watcher that
/// fails to establish (e.g. a root that vanished under it).
public struct UnavailableFileWatcher: SiteFileWatching {
    /// Thrown by ``start(root:onBatch:)`` unconditionally — no per-case detail because the only
    /// failure mode is "this platform has no watcher".
    public struct Unavailable: Error {}

    /// Creates the placeholder watcher. Stateless; every instance behaves identically.
    public init() {}

    /// Always throws ``Unavailable`` — failing at `start` (rather than accepting the callback
    /// and never firing it) routes callers onto their existing "run without live reindexing"
    /// degradation path instead of leaving them believing a watch exists.
    public func start(root: URL, onBatch: @escaping @Sendable (FileChangeBatch) -> Void) throws {
        throw Unavailable()
    }

    /// No-op — ``start(root:onBatch:)`` never establishes anything, so there is nothing to
    /// tear down; safe under callers' unconditional-teardown pattern.
    public func stop() {}
}

/// Composition-root factory for the platform's default file watcher. Call sites in the portable
/// core depend on `any SiteFileWatching` and use this only as their production default; tests
/// inject fakes (e.g. `ControllableWatcher`) directly.
public enum PlatformFileWatcher {
    /// Returns the platform's watcher: `FSEventsFileWatcher` on macOS, `InotifyFileWatcher` on
    /// Glibc platforms, otherwise ``UnavailableFileWatcher`` — the `#if` lives here so portable
    /// call sites never carry platform conditionals themselves.
    public static func make() -> any SiteFileWatching {
        #if os(macOS)
        FSEventsFileWatcher()
        #elseif canImport(Glibc)
        InotifyFileWatcher()
        #else
        UnavailableFileWatcher()
        #endif
    }
}
