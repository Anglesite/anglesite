import AnglesiteCore
import Foundation

/// Per-siteID registry of live `PreviewAnnotationProvider`s.
///
/// `ElementEntity` ids encode the siteID (`"{siteID}:element:{elementID}"`), so the system AI
/// can look up the right provider by parsing the id of any entity it's trying to resolve. The
/// registry is the production binding for `ElementEntityQuery.entities(for:)` — without it,
/// `ElementEntityProviderOverride.scoped` only fires in test contexts and queries return `[]`
/// in production, which would break Siri's deferred-resolution paths (Shortcuts replay, async
/// completions, Spotlight intent restoration).
///
/// **Lifecycle** is window-scoped: `SiteWindow.loadAndStart` registers when the provider is
/// created / re-created on siteID change, and `SiteWindow.onDisappear` unregisters. Mirrors
/// the `EditRouterRegistry` pattern.
///
/// `@MainActor` because `PreviewAnnotationProvider` is; the registry never hops off the main
/// actor. Tests use the lighter-weight `ElementEntityProviderOverride.scoped` TaskLocal seam.
@MainActor
public final class PreviewAnnotationProviderRegistry: Sendable {
    /// The process-wide registry every production caller goes through — a singleton because
    /// ``ElementEntityQuery`` is instantiated by the AppIntents runtime and has no injection point.
    public static let shared = PreviewAnnotationProviderRegistry()

    private var providers: [String: PreviewAnnotationProvider] = [:]

    /// `internal` — production code reaches the registry via `.shared`; tests construct their
    /// own isolated instances via `@testable import`. Prevents accidental third-party
    /// instances from silently routing queries to the wrong store.
    internal init() {}

    /// Bind `provider` as the live provider for `siteID`, replacing any previous binding —
    /// last registration wins, which is what a window re-creating its provider on siteID
    /// change needs.
    public func register(_ provider: PreviewAnnotationProvider, for siteID: String) {
        providers[siteID] = provider
    }

    /// Drop the binding for `siteID` (window closed). Safe to call when nothing is registered,
    /// so `onDisappear` doesn't need to track whether registration ever happened.
    public func unregister(siteID: String) {
        providers.removeValue(forKey: siteID)
    }

    /// The live provider for `siteID`, or `nil` when that site has no open window.
    public func provider(for siteID: String) -> PreviewAnnotationProvider? {
        providers[siteID]
    }

    /// Resolve an `ElementEntity` id to its live entity by parsing the embedded siteID and
    /// asking the registered provider. Returns `nil` when the id is malformed, the site isn't
    /// open, or the element isn't in the latest report. Called from `ElementEntityQuery`.
    public func resolveElement(entityID id: String) -> ElementEntity? {
        guard let siteID = Self.siteID(from: id) else { return nil }
        return providers[siteID]?.elementEntity(forID: id)
    }

    /// All currently-registered siteIDs. Surfaced for tests + diagnostics; production callers
    /// generally know the siteID they're asking about.
    public func knownSiteIDs() -> Set<String> {
        Set(providers.keys)
    }

    /// Pull the siteID prefix out of an `ElementEntity` id. Mirrors the format
    /// `ElementEntity.makeID(siteID:elementID:)` produces — kept here (not on `ElementEntity`)
    /// because the inverse is a registry-lookup concern, not a property of the entity itself.
    public static func siteID(from entityID: String) -> String? {
        guard let range = entityID.range(of: ":element:") else { return nil }
        let siteID = String(entityID[..<range.lowerBound])
        return siteID.isEmpty ? nil : siteID
    }
}
