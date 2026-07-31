import AppIntents
import AnglesiteCore
import CoreGraphics
import Foundation

// The AppKit-coupled `AppEntityUIElement` surface (the `_AppIntents_AppKit` cross-import
// overlay) lives in `PreviewAnnotationProviderUIElements.swift`, macOS-gated, so this file —
// and the provider itself — stays platform-neutral for the iOS thin client (#71).

/// Per-WKWebView state holding the latest `VisibleElementReport` and mapping each element to
/// an `AppEntity`. AppKit's `appEntityUIElementProvider` (B.4 / #148) reads from this when
/// Siri hit-tests the preview pane; intents (B.5 / #149) reach in via `entity(for:)` to
/// resolve an `ElementEntity` id back to live state.
///
/// **One provider per site window** — siteID is captured at construction time. The
/// `SiteContentGraph` is shared (one actor across the app); the provider asks it on each
/// update so live indexing (new image lands, page renames) doesn't strand stale annotations.
///
/// **Mapping priority** (corrected vs the issue spec, see PR notes for #146):
///   1. `<img>` with a `src` matching an `ImageEntity` → `ImageEntity`
///   2. `data-anglesite-id` matches a `PostEntity.id` → `PostEntity`
///   3. `pagePath` matches a `PageEntity.route` → `PageEntity`
///   4. Otherwise → transient `ElementEntity`
///
/// As written in the issue, rules 2 and 3 are swapped; every visible element has a `pagePath`,
/// so rule 3 would make the PostEntity rule unreachable. The corrected order has data-id (an
/// explicit author annotation) outrank generic-page fallback.
@MainActor
public final class PreviewAnnotationProvider: ElementEntityProviding, Sendable {
    /// The site this provider annotates — fixed at construction because the provider is
    /// window-scoped (one per site window), not shared across sites.
    public let siteID: String
    private let graph: SiteContentGraph
    private var annotated: [(rect: CGRect, entity: any AppEntity)] = []
    private var elementsByID: [String: ElementEntity] = [:]

    /// Creates a provider bound to one site window. `graph` is the shared `SiteContentGraph`
    /// actor — injected (rather than reaching for a singleton) so tests can supply an isolated
    /// graph.
    public init(siteID: String, graph: SiteContentGraph) {
        self.siteID = siteID
        self.graph = graph
    }

    /// Replace the current annotation set with one derived from `elements`. Each call is a
    /// full snapshot — the JS reporter sends complete batches, so partial updates would
    /// require tracking removals we don't otherwise need.
    public func update(_ elements: [VisibleElement]) async {
        let resolvedGraph = ContentGraphOverride.scoped ?? graph
        // Hoist the per-site image list out of the per-element loop. Each `resolve` call only
        // reads it; doing it once cuts O(n) actor hops to one, regardless of how many IMG
        // elements are in the batch.
        let siteImages = await resolvedGraph.images(for: siteID)
        var nextAnnotated: [(rect: CGRect, entity: any AppEntity)] = []
        var nextElements: [String: ElementEntity] = [:]
        nextAnnotated.reserveCapacity(elements.count)

        for element in elements {
            let rect = CGRect(
                x: element.rect.x,
                y: element.rect.y,
                width: element.rect.width,
                height: element.rect.height
            )
            let entity = await resolve(element, graph: resolvedGraph, siteImages: siteImages)
            nextAnnotated.append((rect: rect, entity: entity))
            if let elementEntity = entity as? ElementEntity {
                nextElements[elementEntity.id] = elementEntity
            }
        }

        annotated = nextAnnotated
        elementsByID = nextElements
    }

    /// Returns the entity at this element id, or `nil` if the id isn't in the latest report.
    /// Currently supports `ElementEntity` ids only; the indexed entity types (Page/Post/Image)
    /// have their own queries via `SiteContentGraph`.
    public func entity(for elementID: String) -> ElementEntity? {
        elementsByID[elementID]
    }

    /// All annotated rects with their entities. Order matches the report's input order,
    /// which preserves the JS reporter's priority sort (heading > image > nav > interactive).
    public func annotations() -> [(rect: CGRect, entity: any AppEntity)] {
        annotated
    }

    // MARK: ElementEntityProviding

    /// ``ElementEntityProviding`` requirement — same lookup as ``entity(for:)``, exposed under
    /// the protocol name so ``ElementEntityQuery`` can resolve ids without knowing the concrete
    /// provider type.
    public func elementEntity(forID id: String) -> ElementEntity? {
        elementsByID[id]
    }

    /// Suggested entities shown to Siri in the disambiguation picker. AppIntents calls this
    /// during prefetch; with the reporter's 50-element cap an uncapped pass-through would
    /// flood the picker. 10 is a comfortable Shortcuts-UI ceiling — same order of magnitude
    /// as the `IndexedEntity` queries' `suggestedEntities()`.
    public func suggestedElementEntities() -> [ElementEntity] {
        Array(elementsByID.values.prefix(suggestedEntityCap))
    }

    // MARK: mapping

    /// Generated `VisibleElement.id`s are `v-<base36>`; `data-anglesite-id` values are
    /// author-chosen strings. Rule 2's `graph.post(id:)` lookup should only run when the id
    /// could plausibly be an author-tagged PostEntity id — the prefix-test below cheaply
    /// avoids the actor hop for every generated id. Source of truth for the prefix is
    /// `JS/edit-overlay/src/visible-elements.ts`'s `idFor()`.
    private static let generatedIDPrefix = "v-"

    private func resolve(
        _ element: VisibleElement,
        graph: SiteContentGraph,
        siteImages: [SiteContentGraph.Image]
    ) async -> any AppEntity {
        // Rule 1: image src matches an indexed asset for this site. `siteImages` is hoisted
        // by `update(_:)` — we iterate the in-memory list, no actor hop per element.
        if element.tag.uppercased() == "IMG", let src = element.src {
            for image in siteImages where imageMatches(image, src: src) {
                return ImageEntity(image)
            }
        }
        // Rule 2: `data-anglesite-id` (sourced verbatim from the JS reporter's `element.id`
        // when an author tagged the element — see `idFor()` in visible-elements.ts) matches
        // a known PostEntity id. Generated ids start with `"v-"` and can't match any indexed
        // entity, so we skip them rather than burn an actor hop on a guaranteed miss.
        if !element.id.hasPrefix(Self.generatedIDPrefix),
           let post = await graph.post(id: element.id) {
            return PostEntity(post)
        }
        // Rule 3: pagePath matches a known page route.
        if let pagePath = element.pagePath {
            for page in await graph.pages(for: siteID) where page.route == pagePath {
                return PageEntity(page)
            }
        }
        // Rule 4: transient ElementEntity. Captures the structured selector for B.5 routing.
        return ElementEntity(
            id: ElementEntity.makeID(siteID: siteID, elementID: element.id),
            displayName: ElementEntity.makeDisplayName(tag: element.tag, hint: element.text),
            siteID: siteID,
            selector: ElementEntity.encodeSelector(element.selector),
            pagePath: element.pagePath ?? "/"
        )
    }
}

/// Cap on `suggestedElementEntities()` — see the method doc for the rationale.
private let suggestedEntityCap = 10

/// Match an image `src` against an indexed `SiteContentGraph.Image`.
///
/// Sites reference images in three shapes:
///   - Absolute relative path:  `/public/images/hero.jpg`
///   - Bare relative path:      `images/hero.jpg`
///   - Full URL (CDN):          `https://cdn.example.com/hero.jpg?v=2`
///
/// **Path-suffix match (preferred).** Equality, or `relativePath` preceded by `/`. The
/// boundary check rejects accidental substring overlaps — without it, `"/pub/extra-images/hero.jpg"`
/// would match `image.relativePath = "images/hero.jpg"` because `"images/hero.jpg"` is a
/// hasSuffix of the longer string.
///
/// **Assumes `relativePath` has no leading slash.** Production constructs `Image.relativePath`
/// from the plugin's `list_content` DTO (see `ContentListing.swift`'s `ImageDTO.image(siteID:)`),
/// which yields bare paths like `"public/images/hero.jpg"`. We defensively strip a leading
/// slash before the suffix check anyway so a future plugin change doesn't silently break
/// matching — the suffix check would otherwise look for `//images/hero.jpg` and never match.
///
/// **Filename fallback.** Compare the last path component. `URL(string:)` strips query strings
/// and fragments before extracting `lastPathComponent` — otherwise a CDN URL with `?v=2` would
/// produce `"hero.jpg?v=2"` and never match. Falls back to NSString's split-on-`/`-only behavior
/// when `URL` can't parse the input (e.g., paths with whitespace that haven't been
/// percent-encoded).
///
/// The filename fallback is deliberately loose — same name in different dirs collapses to one
/// match. That's the right trade-off for hover-to-edit-the-image, where the user has only
/// pointed at one thing.
private func imageMatches(_ image: SiteContentGraph.Image, src: String) -> Bool {
    // Defensive normalize: strip a leading slash so a hypothetical future leading-slash
    // change in the plugin DTO doesn't break the suffix check (which would otherwise look
    // for `//images/hero.jpg`).
    let normalized = image.relativePath.hasPrefix("/")
        ? String(image.relativePath.dropFirst())
        : image.relativePath
    if src == normalized { return true }
    if src.hasSuffix("/\(normalized)") { return true }
    let srcFile = URL(string: src)?.lastPathComponent ?? (src as NSString).lastPathComponent
    if !srcFile.isEmpty, srcFile == image.fileName { return true }
    return false
}
