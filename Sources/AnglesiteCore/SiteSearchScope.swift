import Foundation

/// The kind filter behind the site window's search-field scope bar (#520) — the user-facing
/// vocabulary ("Posts") over `SiteKnowledgeIndex.Document.Kind`'s storage vocabulary
/// (`.post` + `.content`), fed straight to `SiteSearchIndex.search(kinds:)`.
///
/// Lives in AnglesiteCore, not the app target, so CI's SwiftPM suites can enforce the mappings —
/// hosted app-target tests don't run there (see CLAUDE.md "Build"). Localized titles stay in the
/// app target, where the String Catalog extractor can see them.
///
/// Raw values are persisted with the window's scene state, so they're API in the same sense
/// `SiteToolbarItemID`'s are: renaming one silently resets every user's chosen scope.
public enum SiteSearchScope: String, CaseIterable, Sendable, Identifiable {
    case all
    case pages
    case posts
    case components
    case styles

    public var id: String { rawValue }

    /// The document kinds this scope searches, or `nil` for no filter.
    ///
    /// `all` is deliberately `nil` rather than the union of the other cases' kinds: the index
    /// also holds `.config`, `.script`, and `.other` documents, which no narrowing scope names,
    /// so an explicit union would make "All" quietly search less than all.
    public var kinds: Set<SiteKnowledgeIndex.Document.Kind>? {
        switch self {
        case .all: nil
        case .pages: [.page]
        // `.content` is the kind for a collection entry outside the post-shaped collections;
        // both read as "a piece of writing" to someone scanning the scope bar.
        case .posts: [.post, .content]
        // Layouts are components as far as the editor and the user's mental model go — the
        // navigator's Components group already holds both.
        case .components: [.component, .layout]
        case .styles: [.style]
        }
    }
}
