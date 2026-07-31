import AppIntents
import AnglesiteCore
import Foundation

/// Transient onscreen element entity — covers the fallback case in `PreviewAnnotationProvider`'s
/// mapping rules (B.2 / #146) where a visible DOM element doesn't correspond to any indexed
/// Page/Post/Image. Lets Siri say "edit this" against arbitrary headings, buttons, links, etc.
///
/// **Not `IndexedEntity`** — these are tied to the live overlay state and would churn Spotlight
/// constantly. Only `PreviewAnnotationProvider` can resolve them, and only while the WKWebView
/// is showing the page that produced them. Once that page navigates, the entity is gone.
///
/// **Selector field is a JSON string.** Stores the same structured `ElementInfo`-as-`JSONValue`
/// shape used by `EditMessage`, encoded so it survives `AppEntity` persistence as a plain
/// `String`. Call `selectorJSON()` to materialize the `JSONValue` for routing.
public struct ElementEntity: AppEntity, Identifiable, Sendable {
    /// `"{siteID}:element:{elementID}"` — compose via ``ElementEntity/makeID(siteID:elementID:)``
    /// so the prefix-based kind routing shared with the indexed entities keeps working.
    public let id: String
    /// Human-readable label like `"h1 — Welcome to my site"`; compose via
    /// ``ElementEntity/makeDisplayName(tag:hint:)`` so truncation and whitespace collapsing
    /// stay uniform.
    public let displayName: String
    /// Owning site's stable UUID — routes the edit to the right window's bridge/provider.
    public let siteID: String
    /// JSON-encoded `ElementInfo` selector (see the type-level note on why it's a `String`);
    /// decode with ``ElementEntity/selectorJSON()``, never by hand.
    public let selector: String
    /// Source path of the page the element was observed on (e.g. `src/pages/about.astro`) —
    /// the file an `apply_edit` patch targets.
    public let pagePath: String

    /// Kind name Siri/Shortcuts shows for this entity type.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Element" }

    /// Title is the tag+hint display name; subtitle is the page path, which disambiguates
    /// identical elements (e.g. two "h1 — Welcome" on different pages).
    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(displayName)", subtitle: "\(pagePath)")
    }

    /// Resolution goes through ``ElementEntityQuery`` — live-provider-backed, never Spotlight.
    public static let defaultQuery = ElementEntityQuery()

    /// Memberwise initializer; public because entities are constructed outside this target
    /// (by ``PreviewAnnotationProvider``'s mapping and by tests).
    public init(id: String, displayName: String, siteID: String, selector: String, pagePath: String) {
        self.id = id
        self.displayName = displayName
        self.siteID = siteID
        self.selector = selector
        self.pagePath = pagePath
    }
}

extension ElementEntity {
    /// Compose the canonical entity id for an element. Same `"{siteID}:{kind}:{key}"` shape as
    /// `PageEntity` / `PostEntity` / `ImageEntity`, so a single string-based switch (e.g.
    /// `entityID.hasPrefix("\(siteID):element:")`) can route by kind.
    public static func makeID(siteID: String, elementID: String) -> String {
        "\(siteID):element:\(elementID)"
    }

    /// Compose "h1 — Welcome to my site" / "div — Go" / "img — banner.png".
    /// Tag is lowercased; the hint is truncated to 50 chars with an ellipsis when overlong.
    public static func makeDisplayName(tag: String, hint: String?) -> String {
        let tagPart = tag.lowercased()
        guard let raw = hint?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return tagPart
        }
        let collapsed = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let truncated = collapsed.count > 50
            ? collapsed.prefix(49) + "\u{2026}"
            : Substring(collapsed)
        return "\(tagPart) \u{2014} \(truncated)"
    }

    /// Decode the JSON-string selector back into the structured `JSONValue` shape that
    /// `EditMessage.selector` requires. Returns `nil` when the string isn't a usable selector
    /// — callers treat that as "drop the edit", matching how `EditMessage.decode` rejects
    /// non-object selectors at the WKWebView boundary.
    ///
    /// "Usable" means: parses as JSON, is a JSON object, AND carries the `tag` field the
    /// plugin's `server/selector.mjs` needs to resolve. The `tag` guard is what catches the
    /// `encodeSelector("{}")` round-trip case — an empty object is technically valid JSON but
    /// would otherwise pass downstream and fail at the plugin with a less-actionable error.
    public func selectorJSON() -> JSONValue? {
        guard let data = selector.data(using: .utf8) else { return nil }
        guard let raw = try? JSONSerialization.jsonObject(with: data) else { return nil }
        guard let jv = JSONValue.from(raw), case .object(let dict) = jv else { return nil }
        guard dict["tag"] != nil else { return nil }
        return jv
    }

    /// Encode a structured selector to the string form stored on the entity. Round-trips with
    /// `selectorJSON()`. Non-object inputs return `"{}"` — `selectorJSON()`'s `tag` guard then
    /// rejects them on the way back, so the nil-on-bad-input contract holds end-to-end.
    public static func encodeSelector(_ selector: JSONValue) -> String {
        guard case .object = selector else { return "{}" }
        guard let data = try? JSONSerialization.data(withJSONObject: selector.rawValue) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}

/// Resolves `ElementEntity` references from a live `PreviewAnnotationProvider`.
///
/// **Resolution chain** (first hit wins):
/// 1. `ElementEntityProviderOverride.scoped` — short-lived `@TaskLocal` for test injection.
/// 2. `PreviewAnnotationProviderRegistry.shared` — long-lived per-siteID registry the app
///    populates from `SiteWindow`'s lifecycle (B.4 / #148 wiring).
///
/// In production the registry path is the one that fires; the TaskLocal exists so unit tests
/// can drive a stub without coupling to `@MainActor` shared state.
public struct ElementEntityQuery: EntityQuery {
    /// Stateless — all lookup state lives in the provider/registry the query consults.
    public init() {}

    /// Resolves entity IDs against the live provider. Unresolvable IDs are silently dropped
    /// (not errors): these entities are transient by design, so a stale ID after a page
    /// navigation is the normal case, and Siri handles a missing entity better than a thrown
    /// failure.
    public func entities(for identifiers: [String]) async throws -> [ElementEntity] {
        var out: [ElementEntity] = []
        for id in identifiers {
            if let entity = await resolve(id) {
                out.append(entity)
            }
        }
        return out
    }

    /// Elements Siri may offer proactively ("edit this heading" without a prior selection).
    public func suggestedEntities() async throws -> [ElementEntity] {
        if let provider = await ElementEntityProviderOverride.scoped {
            return await provider.suggestedElementEntities()
        }
        // Production: aggregate suggestions across every registered provider. With one window
        // open this is just that window's set; multi-window users get the union. The provider
        // already caps each contribution at 10 (`suggestedEntityCap`).
        var merged: [ElementEntity] = []
        for siteID in await PreviewAnnotationProviderRegistry.shared.knownSiteIDs() {
            if let p = await PreviewAnnotationProviderRegistry.shared.provider(for: siteID) {
                merged.append(contentsOf: await p.suggestedElementEntities())
            }
        }
        return merged
    }

    private func resolve(_ id: String) async -> ElementEntity? {
        if let provider = await ElementEntityProviderOverride.scoped,
           let entity = await provider.elementEntity(forID: id) {
            return entity
        }
        return await PreviewAnnotationProviderRegistry.shared.resolveElement(entityID: id)
    }
}

/// Indirection so `ElementEntityQuery` can find a stub provider without coupling
/// `AnglesiteIntents` to its `@MainActor` registry. `@TaskLocal` — only ever set by tests
/// (`Override.$scoped.withValue(provider) { ... }`). In production this is `nil` and
/// resolution falls through to `PreviewAnnotationProviderRegistry.shared`.
@MainActor
public enum ElementEntityProviderOverride {
    /// The injected stub provider, or `nil` in production. Task-local so parallel tests can
    /// each bind their own stub without racing on shared mutable state.
    @TaskLocal public static var scoped: ElementEntityProviding?
}

/// What `ElementEntityQuery` needs from a provider. The concrete type
/// (`PreviewAnnotationProvider`) implements it; tests can stub it without touching the real
/// provider's state machine.
@MainActor
public protocol ElementEntityProviding: AnyObject, Sendable {
    /// Resolves an entity ID back to a live element, or `nil` when the page that produced it
    /// has navigated away — callers must treat `nil` as "gone", not as an error.
    func elementEntity(forID id: String) -> ElementEntity?
    /// The provider's current proactive-suggestion set, already capped by the provider
    /// (`suggestedEntityCap`) so aggregating across windows stays bounded.
    func suggestedElementEntities() -> [ElementEntity]
}
