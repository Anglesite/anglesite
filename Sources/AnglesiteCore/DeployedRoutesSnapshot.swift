import Foundation

/// Reads/writes `Config/last-deployed-routes.json` — the route set published by the most recent
/// successful deploy. App-owned state (never committed to the site's git repo, matching
/// `DependencyBaseline`'s precedent), used solely as the "previous" side of
/// `RouteCoverageScanner`'s diff.
public enum DeployedRoutesSnapshot {
    /// The snapshot's filename inside the package's `Config/` directory — public so tests and
    /// callers resolve the same path this type reads and writes.
    public static let filename = "last-deployed-routes.json"

    /// `nil` (not a throw) when the file is absent or unreadable — the normal "no prior deploy
    /// yet" case, which `RouteCoverageScanner` treats as "nothing to diff against."
    public static func load(from configDirectory: URL) -> [String]? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([String].self, from: data)
    }

    /// Writes the route set, deduplicated and sorted so identical route sets always produce
    /// byte-identical files (stable diffs), and atomically so a crash mid-write can't leave a
    /// torn snapshot for the next ``load(from:)`` to misread as "no prior deploy."
    public static func save(_ routes: [String], to configDirectory: URL) throws {
        let url = configDirectory.appendingPathComponent(filename)
        let data = try JSONEncoder().encode(Array(Set(routes)).sorted())
        try data.write(to: url, options: .atomic)
    }
}
