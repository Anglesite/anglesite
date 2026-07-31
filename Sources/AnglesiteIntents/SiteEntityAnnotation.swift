import AppIntents
import Foundation

// Note: `AppEntityAnnotatable` is a protocol for *holders* of an entity reference (NSUserActivity,
// NSView) — not for entities themselves. `NSUserActivity` already conforms to it via the SDK.
// We do not add a conformance on `SiteEntity` because `SiteEntity` is the entity being referenced,
// not the holder. The view-side annotation (`View.appEntityIdentifier`) lands in Task 2.

/// Builds the `NSUserActivity` published by a `SiteWindow` while the window is frontmost.
/// Kept Foundation-only so it's unit-testable under `swift test` without dragging SwiftUI in.
///
/// The activity gives the system AI a second channel to resolve "this site" — distinct from
/// `View.appEntityIdentifier`. Siri voice invocations don't always traverse the view tree, but
/// they reliably see the frontmost window's `NSUserActivity`, so publishing the entity id here
/// covers that path. On Xcode 27 we also set the typed `appEntityIdentifier` so the system can
/// resolve without parsing `userInfo`.
public enum SiteEntityAnnotation {
    /// Reverse-DNS style; the suffix matches the SwiftUI scene that publishes it.
    public static let activityType = "io.dwk.anglesite.site-window"

    /// Builds the activity for one site window: title + `siteID` in `userInfo`, plus (on Swift
    /// 6.4+) the typed `appEntityIdentifier`. Deliberately opts out of Handoff, public indexing,
    /// and search — this is local window state, not a portable document; #71 (iOS thin client)
    /// revisits with SyncableEntity.
    public static func makeSiteUserActivity(_ entity: SiteEntity) -> NSUserActivity {
        let activity = NSUserActivity(activityType: activityType)
        activity.title = entity.displayName
        activity.userInfo = ["siteID": entity.id]
        // Local UI state, not a portable user document — opt out of every cross-device path.
        // #71 (iOS thin client) will revisit this with SyncableEntity.
        activity.isEligibleForHandoff = false
        activity.isEligibleForPublicIndexing = false
        activity.isEligibleForSearch = false
        #if compiler(>=6.4)
        // Typed entity identifier — the system AI uses this in preference to userInfo parsing
        // when resolving onscreen entities. Mirrors what CSSearchableIndex.indexAppEntities
        // publishes for SiteEntity in SpotlightIndexer.
        // NSUserActivity conforms to AppEntityAnnotatable via the SDK (macOS 15.2+).
        activity.appEntityIdentifier = EntityIdentifier(for: entity)
        #endif
        return activity
    }
}
