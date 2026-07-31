import Foundation
import Observation

/// Lets `OpenSiteIntent` (which can't call SwiftUI's `openWindow`) request a site window.
/// The "Sites" scene observes `requested` and opens/focuses the matching per-site window.
@MainActor
@Observable
public final class WindowRouter {
    /// The process-wide router. A singleton (with a private init) because both ends of the
    /// hand-off — intents on one side, the observing SwiftUI scenes on the other — have no
    /// common injection point.
    public static let shared = WindowRouter()
    private init() {}

    /// The site id the intent asked to open; the scene clears it after handling.
    public var requested: String?

    /// Pending navigation per site, set with an open request and consumed once by that site's
    /// window — which observes `pendingNavigation` and clears its own entry, the same shape
    /// `newSiteRequested` uses below. It is *separate* from `requested` (the scene's open/focus
    /// trigger, which the scene clears before the window ever sees it) because a window already
    /// on screen must still react to a new page request. Keyed by siteID so one site's window
    /// can't pick up another's; re-requesting overwrites the pending value (last request wins).
    ///
    /// The value is itself optional: a route navigates there; `nil` resets the preview to the
    /// site root (a plain "preview my site" issued after a prior page navigation).
    public private(set) var pendingNavigation: [String: String?] = [:]

    /// Requests that `siteID`'s window open (or focus), optionally navigating its preview:
    /// `route` navigates there, an explicit `nil` resets to the site root — passing `nil` still
    /// records a pending navigation, which is why an already-open window reacts to a plain
    /// "preview my site".
    public func requestOpen(siteID: String, route: String? = nil) {
        // `updateValue` (not `pendingNavigation[siteID] = route`) so a `nil` route records the
        // key with a nil value — "reset to root" — instead of removing the entry.
        pendingNavigation.updateValue(route, forKey: siteID)
        requested = siteID
    }

    /// Take (and clear) the pending navigation for `siteID`. Returns `.none` when nothing is
    /// pending, `.some(nil)` to reset to the site root, or `.some(route)` to navigate there.
    public func consumeNavigation(for siteID: String) -> String?? {
        pendingNavigation.removeValue(forKey: siteID)
    }

    /// Pending "open the design-interview sheet" request per site, set by
    /// `StartDesignInterviewIntent` and consumed once by that site's window — mirrors
    /// `pendingNavigation`'s set-then-consume shape. Kept as its own `Set` (not folded into
    /// `pendingNavigation`) because it targets a different surface (the design-interview sheet,
    /// not the preview's page route) and carries no route value of its own.
    public private(set) var pendingDesignInterview: Set<String> = []

    /// Requests that `siteID`'s window open (or focus), then present the design-interview sheet.
    public func requestDesignInterview(siteID: String) {
        pendingDesignInterview.insert(siteID)
        requested = siteID
    }

    /// Take (and clear) the pending design-interview request for `siteID`. `true` when one was
    /// pending, `false` otherwise.
    public func consumeDesignInterviewRequest(for siteID: String) -> Bool {
        pendingDesignInterview.remove(siteID) != nil
    }

    /// Set by File ▸ New Site (which can't host the wizard sheet itself). The "Sites"
    /// launcher observes this, runs `presentNewSite()`, then clears it via
    /// `clearNewSiteRequest()`. `private(set)` so only the two methods below mutate it —
    /// external callers can't subvert the set-then-consume contract the launcher relies on.
    /// Mirrors `requested`/`requestOpen` for the open-existing path.
    public private(set) var newSiteRequested = false

    /// Flags a pending File ▸ New Site request for the "Sites" launcher to consume — see
    /// ``newSiteRequested`` for the contract.
    public func requestNewSite() { newSiteRequested = true }

    /// Called by the launcher once it has consumed the request.
    public func clearNewSiteRequest() { newSiteRequested = false }

    /// Opens (or focuses) the "Sites" launcher window. AppKit callers — the Dock menu (#522) —
    /// can't reach SwiftUI's `openWindow`, so the launcher root stashes a captured
    /// `OpenWindowAction` here on appear. `OpenWindowAction` is scene-independent, so the closure
    /// stays valid after the capturing view disappears. Nil only before the launcher's first
    /// appearance — and the launcher is the app's default first scene.
    @ObservationIgnored public var openSitesWindow: (@MainActor () -> Void)?
}
