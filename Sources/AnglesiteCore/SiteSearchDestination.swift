import Foundation

/// Where activating a search hit should take the user (#520). Pure and stateless — no I/O, no
/// dependency on the navigator or the window model — so it's testable directly against
/// arbitrary (kind, route, path) inputs, the same shape and reasoning as `ContentRouteResolver`.
///
/// Kept in AnglesiteCore rather than the app target because CI runs no hosted app tests
/// (CLAUDE.md "Build"): the branch worth testing lives here, and `SiteWindowModel` only executes
/// the result.
public enum SiteSearchDestination: Equatable, Sendable {
    /// Select this row in the Site Navigator. Routes the window through the same path a sidebar
    /// click takes, so the preview, inspector, and Related Pages panel all stay in sync.
    case navigator(id: String)
    /// Open this file (path relative to the site's `Source/`) in the editor.
    case file(path: String, group: FileGroup)

    /// Resolves a search hit's fields to a destination, preferring navigator selection over a
    /// raw file open whenever the hit's route matches a row the navigator actually shows.
    ///
    /// - Parameters:
    ///   - kind: The matched document's kind, used to pick the destination's `FileGroup` when it
    ///     falls back to `.file`.
    ///   - route: The matched document's route, if it has one. `nil` always falls back to `.file`.
    ///   - path: The matched document's path relative to the site's `Source/`, used for `.file`.
    ///   - navigatorRouteIDs: route → navigator node id for the rows currently on
    ///     screen. Empty while a window's tree is still loading, which resolves everything to
    ///     `.file` — a usable destination rather than a dropped hit.
    public static func resolve(
        kind: SiteKnowledgeIndex.Document.Kind,
        route: String?,
        path: String,
        navigatorRouteIDs: [String: String]
    ) -> SiteSearchDestination {
        // A non-nil route is only a convention-based guess that some route serves this document
        // (see `ContentRouteResolver`'s note) — matching a row the navigator actually shows is
        // what makes it safe to navigate. Anything else opens the file, which always exists.
        if let route, let id = navigatorRouteIDs[route] {
            return .navigator(id: id)
        }
        return .file(path: path, group: group(for: kind))
    }

    /// Convenience over ``resolve(kind:route:path:navigatorRouteIDs:)`` taking a
    /// ``SiteSearchIndex/Hit`` directly, so call sites can't mismatch a hit's fields.
    public static func resolve(
        hit: SiteSearchIndex.Hit,
        navigatorRouteIDs: [String: String]
    ) -> SiteSearchDestination {
        resolve(kind: hit.kind, route: hit.route, path: hit.path,
                navigatorRouteIDs: navigatorRouteIDs)
    }

    /// `FileGroup` drives `EditorKind.resolve`, so this maps by which editor suits the file —
    /// not by where the file sits on disk.
    private static func group(for kind: SiteKnowledgeIndex.Document.Kind) -> FileGroup {
        switch kind {
        case .page: .pages
        case .post, .content: .posts
        case .component, .layout: .components
        case .style: .styles
        case .config: .metadata
        // Scripts and unclassified files are plain text; `.components` is the group whose
        // editor handles them (`EditorKind.resolve` picks the component editor only for
        // `.astro`, and the text editor otherwise).
        case .script, .other: .components
        }
    }
}
