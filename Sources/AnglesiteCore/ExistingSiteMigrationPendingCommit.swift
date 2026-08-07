import Foundation

/// Durable record of relative paths this migration (#745) wrote but hasn't yet confirmed
/// committed to the site's `Source/` git repo (design doc "Resumability without a transaction
/// log"). App-owned, `Config/`-only — never written into `Source/`, never committed to the
/// site's own repo — same placement rationale as `Config/dependency-baseline.json` and
/// `Config/template-scripts-baseline.json`.
public struct ExistingSiteMigrationPendingCommit: Codable, Equatable, Sendable {
    /// The record's filename inside `Config/` — public so tests and diagnostics can locate the
    /// file without duplicating the string.
    public static let filename = "existing-site-migration-pending-commit.json"

    /// Relative paths written but not yet confirmed committed. Empty is the normal, common state
    /// — every site-open's retry pass (`ExistingSiteMigrationCommitter.retryPendingCommit`) is a
    /// no-op unless a prior run wrote files and then failed (or was interrupted) before its
    /// commit landed.
    public var pendingPaths: [String]

    /// Creates a record; the empty default is the normal never-pending state ``load(from:)`` also
    /// falls back to.
    public init(pendingPaths: [String] = []) {
        self.pendingPaths = pendingPaths
    }

    /// Never fails — an absent or corrupt record reads as "nothing pending," which is the safe
    /// default (worst case, a genuinely-pending commit from a corrupted record is simply retried
    /// on next migration rather than lost, since the underlying files are still on disk either
    /// way).
    public static func load(from configDirectory: URL) -> ExistingSiteMigrationPendingCommit {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(ExistingSiteMigrationPendingCommit.self, from: data)
        else { return ExistingSiteMigrationPendingCommit() }
        return decoded
    }

    /// Writes the record atomically into `configDirectory` — unlike ``load(from:)`` this does
    /// throw, since silently losing a just-recorded pending list would mean a failed commit's
    /// files are never retried.
    public func save(to configDirectory: URL) throws {
        let url = configDirectory.appendingPathComponent(Self.filename)
        let data = try JSONEncoder().encode(self)
        try data.write(to: url, options: .atomic)
    }
}
