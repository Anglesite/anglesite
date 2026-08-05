import Foundation

/// Stable identifiers for the site window's customizable toolbar items (#519).
///
/// These raw values are API: macOS persists each user's toolbar customization keyed by them, so
/// renaming one silently discards every user's saved layout. `SiteToolbarItemIDTests` freezes the
/// full set — change a raw value only with a deliberate migration story.
///
/// Lives in AnglesiteCore (not the app target) solely so CI's SwiftPM test suites can enforce the
/// freeze; hosted app-target tests don't run on CI (see CLAUDE.md "Build").
public enum SiteToolbarItemID: String, CaseIterable, Sendable {
    case panes
    case graph
    case backup
    case audit
    case openInBrowser
    case harden
    /// Domain config drift audit + reconcile (#1171): declared `anglesite.json` vs live Cloudflare.
    case domainConfigAudit
    case onionRouting
    case domain
    case integration
    case siriReadiness
    case relatedPages
    /// Non-MAS builds only; the id stays reserved on MAS so layouts roam across build flavors.
    case github
    case deploy
    case chat
    case inspector
    case styleGuide
    /// iCloud sync status badge (#881) — synced/syncing/waiting-for-iCloud/needs-attention.
    case sync
    /// Open GitHub security advisories + Dependabot alerts badge (#975).
    case securityReports
}
