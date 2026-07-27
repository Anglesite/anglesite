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

/// Seam over iCloud materialization that `SyncEngine.pull()` (and `push()`'s no-op comparison)
/// use to make sure the sync artifact is actually present on disk with real content before
/// reading it — an evicted item needs `startDownloadingUbiquitousItem` and a wait, not an
/// immediate read.
///
/// **Scope of this phase (#879).** A `VersionStore` only answers "is the *current* version of
/// this file materialized" — single-version behavior, no conflict-version enumeration. P4
/// (concurrent-edit reconciliation, design doc §3) extends this seam with a method that lists the
/// other `NSFileVersion`s iCloud is holding as conflict copies of the same file, for fetching
/// every peer's history rather than just the current one; that's a new, additive method next to
/// this one; it doesn't change `materialize(at:timeout:)`'s contract, so P3 callers (this file)
/// keep working unmodified. Real conflict versions can't be manufactured in CI, so both phases
/// fake this seam in tests instead of exercising real iCloud.
public protocol VersionStore: Sendable {
    func materialize(at url: URL, timeout: TimeInterval) async -> VersionMaterialization
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
}
#endif
