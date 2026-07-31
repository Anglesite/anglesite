import Foundation

/// Reads/writes `Source/redirects.json` — a git-tracked, ordered list of source→destination
/// path redirects for a site. Unlike `SiteConfigStore`/`ProjectConventionsStore`, this is rooted
/// at `sourceDirectory` (the `Source/` git repo), not `Config/`: redirects are site content, not
/// app-owned state, so they travel with the repo (see the design spec's §1).
///
/// A template-side Astro integration (`scripts/redirects.ts`) is the sole consumer at build time;
/// this type only owns the read/write/validate contract the app's Redirects UI and the delete
/// flow use to produce that file.
public struct RedirectsStore: Sendable {
    /// One ordered redirect rule, as serialized in `redirects.json`.
    public struct RedirectEntry: Sendable, Equatable, Codable, Identifiable {
        /// HTTP status the redirect responds with; raw values are the wire status codes, so
        /// they round-trip through JSON unchanged.
        public enum Code: Int, Sendable, Codable, CaseIterable {
            /// 301 — the move is permanent; browsers and crawlers may cache it indefinitely.
            case permanent = 301
            /// 302 — temporary; clients keep re-checking the original URL.
            case temporary = 302
        }

        /// Identity is the `source` path — ``RedirectsStore/validate(_:)`` rejects duplicate
        /// sources, so it's unique within any saved list.
        public var id: String { source }
        /// The site-absolute path being redirected away from; must start with `/`.
        public var source: String
        /// Where the redirect goes: a site-absolute path or an absolute `http(s)://` URL.
        public var destination: String
        /// The HTTP status to respond with.
        public var code: Code

        /// Creates an entry. `code` defaults to permanent (301) — the right answer for the
        /// common "page moved" case the Redirects UI serves.
        public init(source: String, destination: String, code: Code = .permanent) {
            self.source = source
            self.destination = destination
            self.code = code
        }
    }

    /// Invariants ``RedirectsStore/validate(_:)`` enforces before anything reaches disk. Each case carries the
    /// offending value(s) so the Redirects UI can point at the exact bad row.
    public enum ValidationError: Error, Equatable {
        /// `source` isn't a site-absolute path starting with `/`.
        case sourceMustStartWithSlash(String)
        /// Two entries share a `source` — only one rule can match a given path, and `source`
        /// is also the entry's `Identifiable` identity.
        case duplicateSource(String)
        /// A direct cycle: either `source == destination`, or an existing entry's destination is
        /// this entry's source and vice versa. Deep chains (A→B→C) are not resolved or rejected —
        /// matches Cloudflare's own behavior of following each hop independently.
        case cycle(String, String)
        /// `source` contains whitespace, which can't appear in a URL path.
        case sourceContainsWhitespace(String)
        /// `destination` contains whitespace, which can't appear in a URL.
        case destinationContainsWhitespace(String)
        /// `destination` is neither a site-absolute path nor an absolute `http(s)://` URL —
        /// relative destinations would resolve differently per requesting page.
        case destinationMustBeAbsolutePathOrURL(String)
    }

    private let fileURL: URL
    private let fileManager: FileManager

    /// Roots the store at `<sourceDirectory>/redirects.json` — inside the `Source/` git repo,
    /// per the type-level rationale that redirects are site content, not app state.
    /// `fileManager` is injectable for tests.
    public init(sourceDirectory: URL, fileManager: FileManager = .default) {
        self.fileURL = sourceDirectory.appendingPathComponent("redirects.json")
        self.fileManager = fileManager
    }

    /// `[]` (not a throw) when the file is absent — the normal "no redirects yet" case for a
    /// freshly scaffolded site.
    public func load() throws -> [RedirectEntry] {
        guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode([RedirectEntry].self, from: data)
    }

    /// Validates, then writes the full entry list (pretty-printed, sorted keys, atomic — the
    /// file is git-tracked and hand-readable, so diffs should stay minimal). Validation runs
    /// here rather than only in the UI, so no code path can persist a file the template-side
    /// build integration would choke on.
    ///
    /// - Throws: A ``ValidationError`` before touching disk, or the underlying encode/write
    ///   error.
    public func save(_ entries: [RedirectEntry]) throws {
        try Self.validate(entries)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(entries)
        try data.write(to: fileURL, options: .atomic)
    }

    /// Checks the whole list's invariants: absolute sources, no whitespace, valid destinations,
    /// no duplicate sources, no direct cycles. Static (and separate from ``save(_:)``) so the
    /// Redirects UI can validate a draft list live without constructing a store or touching disk.
    ///
    /// - Throws: A ``ValidationError`` for the first violation found (per-entry rules are
    ///   checked before the cycle pass).
    public static func validate(_ entries: [RedirectEntry]) throws {
        var seenSources = Set<String>()
        var destinationBySource: [String: String] = [:]
        for entry in entries {
            guard entry.source.hasPrefix("/") else {
                throw ValidationError.sourceMustStartWithSlash(entry.source)
            }
            guard entry.source.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
                throw ValidationError.sourceContainsWhitespace(entry.source)
            }
            guard entry.destination.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
                throw ValidationError.destinationContainsWhitespace(entry.destination)
            }
            guard entry.destination.hasPrefix("/") || entry.destination.hasPrefix("http://") || entry.destination.hasPrefix("https://") else {
                throw ValidationError.destinationMustBeAbsolutePathOrURL(entry.destination)
            }
            guard !seenSources.contains(entry.source) else {
                throw ValidationError.duplicateSource(entry.source)
            }
            seenSources.insert(entry.source)
            destinationBySource[entry.source] = entry.destination
        }
        for entry in entries {
            if entry.source == entry.destination {
                throw ValidationError.cycle(entry.source, entry.destination)
            }
            if destinationBySource[entry.destination] == entry.source {
                throw ValidationError.cycle(entry.source, entry.destination)
            }
        }
    }
}
