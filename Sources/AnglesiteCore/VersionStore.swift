#if canImport(Darwin)
import Foundation

/// Outcome of `VersionStore.materialize(at:timeout:)`.
public enum VersionMaterialization: Sendable, Equatable {
    /// Already present on local disk — no download was needed (a plain local file, or an iCloud
    /// item that was already fully downloaded).
    case alreadyLocal
    /// Was evicted (`NSMetadataUbiquitousItemDownloadingStatusNotDownloaded`, e.g. "Optimize Mac
    /// Storage"); iCloud finished downloading it within the timeout.
    case downloaded
    /// Still not present after the timeout elapsed. Callers should surface a "waiting for iCloud"
    /// state rather than reading a file that isn't really there yet.
    case timedOut
}

/// One `NSFileVersion` conflict copy of a synced item, still pending resolution — a peer Mac's
/// write that iCloud kept as a conflict version rather than folding into the "current" version
/// (design doc `2026-07-21-icloud-git-sync-design.md` §3 step 2). `SyncEngine.pull()` reads
/// `contentURL` the same way it reads the current artifact's own URL — passed straight to
/// `SyncArtifact.fetch(into:namespace:from:)` — and calls `markResolved()` once the history it
/// carries has been folded into a fully-converged merge (§3 step 4).
///
/// `@unchecked Sendable`: `NSFileVersion` itself isn't concurrency-checked by Foundation, but
/// `SyncEngine` (an actor) is the only thing that ever touches a handle, and only within the
/// single `pull()` call that requested it — the same single-threaded discipline this module
/// already leans on for libgit2.
public final class ConflictVersionHandle: @unchecked Sendable, Equatable {
    /// Identity for logging and for naming the synthetic `refs/remotes/peer-<id>` namespace this
    /// version is fetched into — not used to re-locate the underlying `NSFileVersion` (the
    /// wrapped `markResolved` closure already pins that).
    public let id: String
    /// Where this conflict version's content can be read from directly.
    public let contentURL: URL
    private let markResolvedAction: @Sendable () -> Void

    public init(id: String, contentURL: URL, markResolved: @escaping @Sendable () -> Void) {
        self.id = id
        self.contentURL = contentURL
        self.markResolvedAction = markResolved
    }

    /// Marks this conflict version resolved — production removes it from iCloud's conflict list
    /// (`NSFileVersion.isResolved`); called only once the reconciliation that folded its history
    /// in has fully converged, never on a partial or conflicted result.
    public func markResolved() { markResolvedAction() }

    public static func == (lhs: ConflictVersionHandle, rhs: ConflictVersionHandle) -> Bool {
        lhs.id == rhs.id && lhs.contentURL == rhs.contentURL
    }
}

/// Seam over iCloud materialization that `SyncEngine.pull()` (and `push()`'s no-op comparison)
/// use to make sure the sync artifact is actually present on disk with real content before
/// reading it — an evicted item needs `startDownloadingUbiquitousItem` and a wait, not an
/// immediate read.
///
/// **Scope.** `materialize(at:timeout:)` (#879) answers "is the *current* version of this file
/// materialized" — single-version behavior. `conflictVersions(of:)` (#880, design doc §3 step 2)
/// is a new, additive method that lists the other `NSFileVersion`s iCloud is holding as conflict
/// copies of the same file, for fetching every peer's history rather than just the current one;
/// it doesn't change `materialize(at:timeout:)`'s contract, so P3 callers keep working unmodified.
/// Real conflict versions can't be manufactured in CI, so both phases fake this seam in tests
/// instead of exercising real iCloud.
public protocol VersionStore: Sendable {
    func materialize(at url: URL, timeout: TimeInterval) async -> VersionMaterialization

    /// Enumerates `url`'s unresolved NSFileVersion conflict versions — the peer writes iCloud
    /// kept when two Macs wrote the artifact concurrently. Empty when there's no conflict (the
    /// overwhelmingly common case).
    func conflictVersions(of url: URL) async -> [ConflictVersionHandle]
}

/// Production `VersionStore`: polls `URLResourceValues.ubiquitousItemDownloadingStatus`, kicking
/// off `FileManager.startDownloadingUbiquitousItem(at:)` when the item isn't `.current`.
public struct UbiquitousVersionStore: VersionStore {
    /// How often to re-check the downloading status while waiting.
    private let pollInterval: TimeInterval

    public init(pollInterval: TimeInterval = 0.2) {
        self.pollInterval = pollInterval
    }

    public func materialize(at url: URL, timeout: TimeInterval) async -> VersionMaterialization {
        guard let status = Self.downloadingStatus(of: url), status != .current else {
            // Not a ubiquitous item at all (plain local file, resource values unavailable — e.g.
            // in a unit-test temp directory) or already downloaded: nothing to wait for.
            return .alreadyLocal
        }

        try? FileManager.default.startDownloadingUbiquitousItem(at: url)
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if Self.downloadingStatus(of: url) == .current { return .downloaded }
            try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
        }
        return .timedOut
    }

    private static func downloadingStatus(of url: URL) -> URLUbiquitousItemDownloadingStatus? {
        try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]).ubiquitousItemDownloadingStatus
    }

    public func conflictVersions(of url: URL) async -> [ConflictVersionHandle] {
        guard let versions = NSFileVersion.unresolvedConflictVersionsOfItem(at: url) else { return [] }
        return versions.enumerated().map { index, version in
            ConflictVersionHandle(id: "peer-\(index)", contentURL: version.url) {
                version.isResolved = true
            }
        }
    }
}
#endif
