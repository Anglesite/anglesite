import Foundation
import Observation
import AnglesiteCore

/// Drives the site window's toolbar search field (#520) over the `SiteSearchIndex` backend
/// (#765). App glue only: the scope→kinds mapping and the hit→destination decision live in
/// AnglesiteCore (`SiteSearchScope`, `SiteSearchDestination`) where CI can test them.
///
/// Holds no index state of its own — `SiteSearchIndex` reads the live `SiteKnowledgeIndex` on
/// every call, so results always reflect whatever the file-watcher pipeline has most recently
/// applied.
@MainActor
@Observable
final class SiteSearchModel {
    /// The text field's contents. Bound directly by `.searchable`.
    var query: String = ""
    /// The scope bar's selection. Bound directly by `.searchScopes`.
    var scope: SiteSearchScope = .all

    private(set) var hits: [SiteSearchIndex.Hit] = []
    /// True from the moment a non-empty query is pending until its results land. The suggestions
    /// list reads this to avoid flashing "no matches" during the debounce of a query that will
    /// match.
    private(set) var isSearching = false

    /// Matches `SiteSearchIndex.search`'s own default. Eight rows is about what a search-field
    /// dropdown shows without scrolling; deeper archive search is the reader-facing surface.
    private static let resultLimit = 8

    /// Long enough that typing a word doesn't fan out a query per keystroke, short enough to
    /// feel immediate.
    private static let debounce = Duration.milliseconds(150)

    private let index: SiteKnowledgeIndex

    init(index: SiteKnowledgeIndex) {
        self.index = index
    }

    /// The identity `SiteWindow`'s `.task(id:)` keys on, so SwiftUI cancels an in-flight search
    /// whenever the query or scope changes. That cancellation is what implements both the
    /// debounce and the staleness guard — a superseded search stops at its next suspension point
    /// instead of racing the newer one to `hits`.
    struct Request: Equatable {
        let query: String
        let scope: SiteSearchScope
    }

    var request: Request { Request(query: query, scope: scope) }

    /// Runs the current `request` against `siteID` after the debounce. Cancellation-aware, so it
    /// is safe to call from `.task(id:)`; returns without touching `hits` when superseded.
    func search(siteID: String?) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let siteID, !trimmed.isEmpty else {
            hits = []
            isSearching = false
            return
        }

        isSearching = true
        // A cancelled sleep throws, which is exactly the debounce: the superseded call leaves
        // `isSearching` set and returns, and the newer one owns the flag from here.
        do { try await Task.sleep(for: Self.debounce) } catch { return }

        let results = await SiteSearchIndex.search(
            index, siteID: siteID, query: trimmed,
            limit: Self.resultLimit, kinds: scope.kinds)
        guard !Task.isCancelled else { return }

        hits = results
        isSearching = false
    }

    /// The hit to activate for the current field contents — a selected suggestion (whose
    /// completion put its path in the field) or, for typed text committed with Return, the
    /// top-ranked hit. `nil` when nothing matched.
    func submit() -> SiteSearchIndex.Hit? {
        SiteSearchIndex.hit(forSubmittedQuery: query, in: hits)
    }

    /// Dismisses the suggestions list after the user picks a hit. Clearing the query is what
    /// closes the dropdown; the field itself keeps focus per macOS convention.
    func clear() {
        query = ""
        hits = []
        isSearching = false
    }
}
