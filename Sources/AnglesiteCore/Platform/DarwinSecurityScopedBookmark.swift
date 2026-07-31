// Darwin implementation of the SecurityScopedBookmark seam. The whole file compiles out on
// platforms without the App Sandbox's `.withSecurityScope` bookmark APIs (macOS-only —
// iOS Foundation has no `.withSecurityScope`, so iOS takes the Unavailable path).
#if os(macOS)
import Foundation

/// MAS-only at runtime: the sandboxed app persists one bookmark per site (on
/// `SiteStore.Site.bookmarkData`), resolves it at window-open time, and holds the grant via
/// `startAccessing` for the window's lifetime so the directly-spawned Node/Astro/wrangler
/// children inherit folder access. Nothing crosses a process boundary — the app is the sole
/// grant holder (see docs/specs/2026-05-27-sandboxed-app-store-plan.md, "ARCHITECTURE PIVOT").
public struct DarwinSecurityScopedBookmark: SecurityScopedBookmarking {
    /// Creates the Darwin implementation. Stateless — all state lives in the bookmark data
    /// and in the URL's own access scope.
    public init() {}

    /// Creates a `.withSecurityScope` bookmark for `url`. Foundation's thrown error is
    /// flattened to its localized description inside the portable
    /// `SecurityScopedBookmarkError.createFailed`, so callers outside `Platform/` never
    /// handle a Darwin-specific error type.
    public func create(for url: URL) throws -> Data {
        do {
            return try url.bookmarkData(
                options: .withSecurityScope,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
        } catch {
            throw SecurityScopedBookmarkError.createFailed(error.localizedDescription)
        }
    }

    /// Resolves a stored bookmark back to a URL, forwarding Foundation's staleness flag so
    /// the caller can re-`create` and persist a fresh bookmark (staleness is expected after
    /// the target moves or the OS rotates bookmark internals — not an error).
    public func resolve(_ data: Data) throws -> SecurityScopedBookmarkResolution {
        var isStale = false
        do {
            let url = try URL(
                resolvingBookmarkData: data,
                options: .withSecurityScope,
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            return SecurityScopedBookmarkResolution(url: url, isStale: isStale)
        } catch {
            throw SecurityScopedBookmarkError.resolveFailed(error.localizedDescription)
        }
    }

    /// Claims the sandbox grant for a resolved URL. Only meaningful for URLs that came out of
    /// `resolve(_:)`; `false` means the grant could not be taken (e.g. a stale bookmark's
    /// target is gone) and file access will fail with sandbox denials.
    public func startAccessing(_ url: URL) -> Bool {
        url.startAccessingSecurityScopedResource()
    }

    /// Releases a grant taken by `startAccessing(_:)`. Calls must balance — the sandbox
    /// counts kernel-level references, and a leaked grant holds the resource open for the
    /// app's lifetime (why `SiteWindow` scopes its grant to the window's lifetime).
    public func stopAccessing(_ url: URL) {
        url.stopAccessingSecurityScopedResource()
    }
}
#endif
