import Foundation

/// One curated `@astroanimate/core` component from the template's `integrations/animations.json`
/// manifest (Resources/Template/integrations/animations.json — schema owned by the template,
/// see `Resources/Template/scripts/animations-catalog.ts`). Foundation-only: the Linux CI lane
/// builds AnglesiteCore, so no AppKit/Darwin-only APIs belong here — the AppKit-facing gallery UI
/// lives in `Sources/AnglesiteApp/AnimationsGalleryView.swift`.
public struct AnimationCatalogEntry: Sendable, Codable, Identifiable, Hashable {
    /// `Identifiable` conformance for SwiftUI lists — the component export name, which the
    /// manifest keeps unique, so no separate id field is needed.
    public var id: String { component }
    /// The `@astroanimate/core` export name (e.g. `FadeInText`) — the stable key everything else
    /// (demo pages, snippets, identity) derives from.
    public let component: String
    /// Short human title shown in the gallery grid.
    public let title: String
    /// Plain-language description written for site owners, not developers — the gallery's
    /// audience. Named `ownerDescription` to keep that framing explicit (and to stay clear of
    /// `CustomStringConvertible`'s `description`).
    public let ownerDescription: String
    /// Which gallery section the entry belongs to.
    public let category: AnimationCategory
    /// The props worth tuning, mapped to a human hint about each (e.g. `"duration"` →
    /// `"seconds (default 0.6)"`) — display strings for the gallery, not machine-readable
    /// defaults.
    public let keyProps: [String: String]
    /// Ready-to-paste Astro usage snippet, import line included.
    public let snippet: String
}

/// `category` values from the manifest schema: `text | cards | buttons | backgrounds | navigation`.
public enum AnimationCategory: String, Sendable, Codable, CaseIterable, Hashable {
    /// Headline/body text effects (fades, reveals).
    case text
    /// Card and container entrance/hover effects.
    case cards
    /// Button hover and press feedback.
    case buttons
    /// Full-bleed background motion.
    case backgrounds
    /// Menu and navigation transitions.
    case navigation
}

/// Decodes the template's curated Astro Animate catalog and locates its prerendered demo pages.
public struct AnimationCatalog: Sendable {
    /// Every curated entry, preserving manifest order — the template's curation order *is* the
    /// gallery's display order, so no re-sorting happens app-side.
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
