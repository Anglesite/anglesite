import Foundation

/// Portable seam for macOS App Sandbox security-scoped bookmarks (cross-platform port design,
/// docs/superpowers/specs/2026-07-08-cross-platform-swift-port-design.md §5), mirroring the
/// `SecretStore`/`SiteFileWatching` seams: portable protocol + per-platform implementations,
/// `#if` guards confined to `Platform/`.
///
/// Implementations: `DarwinSecurityScopedBookmark` (macOS App Sandbox, backed by
/// `URL.bookmarkData(options: .withSecurityScope, ...)`). Non-Darwin platforms have no App
/// Sandbox equivalent, so `UnavailableSecurityScopedBookmark` is used — create/resolve always
/// fail and start/stop grant nothing, matching how callers already treat "no grant" as an
/// ordinary, user-facing failure (see `SiteAccess`).
public protocol SecurityScopedBookmarking: Sendable {
    /// Create a security-scoped bookmark for `url`. The caller must have access at create time
    /// (typically: the URL just returned from `NSOpenPanel`).
    func create(for url: URL) throws -> Data

    /// Resolve a previously-created bookmark. The caller must `startAccessing` the returned URL
    /// before use and `stopAccessing` when done. A `true` `isStale` means the caller should
    /// re-`create` a fresh bookmark (after starting access) and persist it.
    func resolve(_ data: Data) throws -> SecurityScopedBookmarkResolution

    /// Starts access to a resolved scoped resource. Returns whether access was granted.
    @discardableResult
    func startAccessing(_ url: URL) -> Bool

    /// Stops access previously granted by `startAccessing`.
    func stopAccessing(_ url: URL)
}

/// The result of resolving a stored bookmark: the URL to access plus the platform's staleness
/// signal, surfaced as data so portable callers can implement the re-create-and-persist dance
/// without touching `URL(resolvingBookmarkData:)` options directly.
public struct SecurityScopedBookmarkResolution: Sendable, Equatable {
    /// The resolved file URL. Callers must bracket use with
    /// ``SecurityScopedBookmarking/startAccessing(_:)`` / ``SecurityScopedBookmarking/stopAccessing(_:)``.
    public let url: URL
    /// `true` when the platform reports the bookmark data is stale — the caller should re-create
    /// a fresh bookmark (after starting access) and persist it in place of the old data.
    public let isStale: Bool

    /// Creates a resolution value. Public so non-Darwin implementations and test fakes can
    /// construct results, not just the Darwin resolver.
    public init(url: URL, isStale: Bool) {
        self.url = url
        self.isStale = isStale
    }
}

/// Failures from creating or resolving a bookmark. Both cases carry a human-readable reason
/// because these surface directly in user-facing import/open flows (see `errorDescription`).
public enum SecurityScopedBookmarkError: Error, Sendable, LocalizedError {
    /// Bookmark creation failed — the caller lacked access to the URL at create time, or the
    /// platform has no bookmark support (``UnavailableSecurityScopedBookmark``).
    case createFailed(String)
    /// Stored bookmark data could not be resolved back to a URL — corrupt data, a deleted
    /// target, or a platform without bookmark support.
    case resolveFailed(String)

    /// Without this conformance, `.localizedDescription` bridges to a generic NSError
    /// ("The operation couldn't be completed. (AnglesiteCore.SecurityScopedBookmarkError error
    /// 0.)") and silently drops the underlying reason carried in the associated `String` — see
    /// #1068, where that's exactly the message users saw at every call site that surfaces this
    /// error (`SiteActions.ImportError`, the new-site "Registering" step).
    public var errorDescription: String? {
        switch self {
        case .createFailed(let message), .resolveFailed(let message):
            message
        }
    }
}

/// Placeholder for platforms without App Sandbox bookmarks (Linux/Windows). `create`/`resolve`
/// always fail; `startAccessing` always reports no access granted — features degrade
/// capability-flagged, never by pretending a grant exists.
public struct UnavailableSecurityScopedBookmark: SecurityScopedBookmarking {
    /// Creates the placeholder implementation. Stateless; every instance behaves identically.
    public init() {}

    /// Always throws ``SecurityScopedBookmarkError/createFailed(_:)`` — there is no bookmark
    /// facility to create with on this platform, and failing loudly beats persisting data that
    /// could never resolve.
    public func create(for url: URL) throws -> Data {
        throw SecurityScopedBookmarkError.createFailed("Security-scoped bookmarks are unavailable on this platform.")
    }

    /// Always throws ``SecurityScopedBookmarkError/resolveFailed(_:)`` — any stored bookmark
    /// data reaching this platform (e.g. a config synced from a Mac) cannot be honored.
    public func resolve(_ data: Data) throws -> SecurityScopedBookmarkResolution {
        throw SecurityScopedBookmarkError.resolveFailed("Security-scoped bookmarks are unavailable on this platform.")
    }

    /// Always `false`: no grant exists, and reporting one would let callers proceed on access
    /// they don't have instead of taking their ordinary "no grant" failure path.
    public func startAccessing(_ url: URL) -> Bool { false }

    /// No-op — ``startAccessing(_:)`` never grants anything, so there is nothing to release.
    public func stopAccessing(_ url: URL) {}
}

/// Composition-root factory for the platform's default bookmark implementation. Call sites in
/// the portable core depend on `any SecurityScopedBookmarking` and use this only as their
/// production default; tests inject fakes directly.
public enum PlatformSecurityScopedBookmark {
    /// Returns the platform's implementation: `DarwinSecurityScopedBookmark` on macOS, otherwise
    /// ``UnavailableSecurityScopedBookmark`` — the `#if` lives here so portable call sites never
    /// carry platform conditionals themselves.
    public static func make() -> any SecurityScopedBookmarking {
        #if os(macOS)
        DarwinSecurityScopedBookmark()
        #else
        UnavailableSecurityScopedBookmark()
        #endif
    }
}

/// Static facade over the platform's default bookmark implementation, kept for the app target's
/// existing MAS-only call sites (`SiteWindowModel`, `SitesLauncherView`, `SiteActions`), which
/// call `SecurityScopedBookmark.create`/`.resolve` directly and are Darwin-only regardless.
public enum SecurityScopedBookmark {
    /// Legacy name those call sites already use for ``SecurityScopedBookmarkResolution``.
    public typealias Resolved = SecurityScopedBookmarkResolution
    /// Legacy name those call sites already use for ``SecurityScopedBookmarkError``.
    public typealias BookmarkError = SecurityScopedBookmarkError

    /// ``SecurityScopedBookmarking/create(for:)`` on the platform default — see the protocol
    /// requirement for the access-at-create-time precondition.
    public static func create(for url: URL) throws -> Data {
        try PlatformSecurityScopedBookmark.make().create(for: url)
    }

    /// ``SecurityScopedBookmarking/resolve(_:)`` on the platform default — see the protocol
    /// requirement for the start/stop-access and staleness contract.
    public static func resolve(_ data: Data) throws -> SecurityScopedBookmarkResolution {
        try PlatformSecurityScopedBookmark.make().resolve(data)
    }
}
