import Foundation

/// Per-siteID registry of live `EditRouter`s.
///
/// Each open `SiteWindow`'s `PreviewModel` registers its `editRouter` here under the site's id,
/// and `IntentEditBridge`'s `RouterProvider` reads it back when an intent (`EditContentIntent`,
/// B.5 / #149) needs to apply an edit. The registry lives in `AnglesiteCore` so both layers can
/// see it; `AnglesiteIntents` doesn't need to know about WKWebView or `PreviewModel`.
///
/// Single shared instance — `EditRouterRegistry.shared`. Routers are kept by strong reference
/// (the protocol isn't `AnyObject`-constrained so weak refs aren't expressible). The owner
/// (`PreviewModel`) is responsible for paired register/unregister around its lifecycle, exactly
/// like its existing `open()` / `close()` pair.
///
/// Last-writer-wins on duplicate siteID registration: opening the same site in a fresh window or
/// rewriting the router via `setEditObserver(_:)` overwrites the prior registration.
public actor EditRouterRegistry {
    /// The single process-wide registry — the only instance production code should touch
    /// (see `init`'s note on why external construction is blocked).
    public static let shared = EditRouterRegistry()

    private var routers: [String: EditRouter] = [:]

    /// `internal` (not `public`) — production callers go through `.shared`; tests reach in
    /// via `@testable import AnglesiteCore` to construct isolated instances. Prevents
    /// accidental external instances from silently routing edits to the wrong store.
    internal init() {}

    /// Registers (or replaces — last-writer-wins, see the type doc) the live router for a
    /// site. Pair with ``unregister(siteID:)`` around the owner's lifecycle, or the strong
    /// reference keeps the router alive after its window closes.
    public func register(_ router: EditRouter, for siteID: String) {
        routers[siteID] = router
    }

    /// Removes a site's router. Safe to call for an unknown siteID (no-op), so owners can
    /// unregister unconditionally on teardown.
    public func unregister(siteID: String) {
        routers.removeValue(forKey: siteID)
    }

    /// The live router for a site, or `nil` when no window has that site open — callers
    /// (intents) treat `nil` as "site not open" and tell the user, rather than falling back
    /// to a router that couldn't reach the preview anyway.
    public func router(for siteID: String) -> EditRouter? {
        routers[siteID]
    }

    /// All currently-registered siteIDs. Surfaced for tests + diagnostics; production callers
    /// always know the siteID they're asking about.
    public func knownSiteIDs() -> Set<String> {
        Set(routers.keys)
    }
}
