import Foundation

/// One curated `@astroanimate/core` component from the template's `integrations/animations.json`
/// manifest (Resources/Template/integrations/animations.json — schema owned by the template,
/// see `Resources/Template/scripts/animations-catalog.ts`). Foundation-only: the Linux CI lane
/// builds AnglesiteCore, so no AppKit/Darwin-only APIs belong here — the AppKit-facing gallery UI
/// lives in `Sources/AnglesiteApp/AnimationsGalleryView.swift`.
public struct AnimationCatalogEntry: Sendable, Codable, Identifiable, Hashable {
    public var id: String { component }
    public let component: String
    public let title: String
    public let ownerDescription: String
    public let category: AnimationCategory
    public let keyProps: [String: String]
    public let snippet: String
}

/// `category` values from the manifest schema: `text | cards | buttons | backgrounds | navigation`.
public enum AnimationCategory: String, Sendable, Codable, CaseIterable, Hashable {
    case text, cards, buttons, backgrounds, navigation
}

/// Decodes the template's curated Astro Animate catalog and locates its prerendered demo pages.
public struct AnimationCatalog: Sendable {
    public let entries: [AnimationCatalogEntry]

    /// Mirrors the manifest's top-level shape (`{ "version": 1, "components": [...] }`); only
    /// `components` is consumed today.
    private struct ManifestFile: Codable {
        let version: Int
        let components: [AnimationCatalogEntry]
    }

    /// Decodes `templateDirectory/integrations/animations.json`.
    public static func load(templateDirectory: URL) throws -> AnimationCatalog {
        let manifestURL = templateDirectory.appendingPathComponent("integrations/animations.json")
        let data = try Data(contentsOf: manifestURL)
        let manifest = try JSONDecoder().decode(ManifestFile.self, from: data)
        return AnimationCatalog(entries: manifest.components)
    }

    /// Curated entries in `category`, in manifest order.
    public func entries(in category: AnimationCategory) -> [AnimationCatalogEntry] {
        entries.filter { $0.category == category }
    }

    /// The prerendered demo page for `component`: `integrations/animations-demos/<component>.html`
    /// under the same template root (see Resources/Template/integrations/animations-demos/).
    public static func demoURL(templateDirectory: URL, component: String) -> URL {
        templateDirectory.appendingPathComponent("integrations/animations-demos/\(component).html")
    }
}
