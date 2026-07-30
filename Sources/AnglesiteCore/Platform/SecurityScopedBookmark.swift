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

public struct SecurityScopedBookmarkResolution: Sendable, Equatable {
    public let url: URL
    public let isStale: Bool

    public init(url: URL, isStale: Bool) {
        self.url = url
        self.isStale = isStale
    }
}

public enum SecurityScopedBookmarkError: Error, Sendable, LocalizedError {
    case createFailed(String)
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
    public init() {}

    public func create(for url: URL) throws -> Data {
        throw SecurityScopedBookmarkError.createFailed("Security-scoped bookmarks are unavailable on this platform.")
    }

    public func resolve(_ data: Data) throws -> SecurityScopedBookmarkResolution {
        throw SecurityScopedBookmarkError.resolveFailed("Security-scoped bookmarks are unavailable on this platform.")
    }

    public func startAccessing(_ url: URL) -> Bool { false }

    public func stopAccessing(_ url: URL) {}
}

/// Composition-root factory for the platform's default bookmark implementation. Call sites in
/// the portable core depend on `any SecurityScopedBookmarking` and use this only as their
/// production default; tests inject fakes directly.
public enum PlatformSecurityScopedBookmark {
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
    public typealias Resolved = SecurityScopedBookmarkResolution
    public typealias BookmarkError = SecurityScopedBookmarkError

    public static func create(for url: URL) throws -> Data {
        try PlatformSecurityScopedBookmark.make().create(for: url)
    }

    public static func resolve(_ data: Data) throws -> SecurityScopedBookmarkResolution {
        try PlatformSecurityScopedBookmark.make().resolve(data)
    }
}
