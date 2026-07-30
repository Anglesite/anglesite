import SwiftUI
import AnglesiteCore

/// The site window's toolbar search field, scope bar, and suggestions list (#520).
///
/// A `ViewModifier` rather than modifiers inlined into `SiteWindow.siteUI(for:)` for the reason
/// documented on `SiteWindow.focusedValues(for:)`: that function is already at Swift's
/// type-check-in-reasonable-time budget, and a `.searchable` + `.searchScopes` +
/// `.searchSuggestions` chain solved as part of the same expression pushes it over.
///
/// Owning `@FocusState` here also keeps the Edit ▸ Find ▸ Search Site… plumbing local: focus
/// state is scene-local and unreachable from a `Commands` tree, so the menu item reaches it
/// through the `siteSearchActions` focused value this modifier publishes.
struct SiteSearchFieldModifier: ViewModifier {
    @Bindable var model: SiteSearchModel
    let siteID: String?
    /// Same binding `SiteWindow` passes to `.inspector(isPresented:)` — read (and, when
    /// presented, written) by `focusSearchField` below to dodge #1126.
    var inspectorPresented: Binding<Bool>
    let activate: (SiteSearchIndex.Hit) -> Void

    @FocusState private var searchFieldFocused: Bool

    func body(content: Content) -> some View {
        content
            .searchable(
                text: $model.query,
                placement: .toolbar,
                prompt: Text("Search Site")
            )
            .searchFocused($searchFieldFocused)
            .searchScopes($model.scope) {
                ForEach(SiteSearchScope.allCases) { scope in
                    Text(scope.title).tag(scope)
                }
            }
            .searchSuggestions {
                if model.hits.isEmpty {
                    // Only for a query the user actually typed, and only once its search has
                    // settled: an untouched field would otherwise greet ⇧⌘F with "no matches",
                    // and every first keystroke would flash it during the debounce of a query
                    // that will match.
                    if model.hasQuery && !model.isSearching {
                        Text("No matching content")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(model.hits) { hit in
                        // `.searchCompletion`, not a `Button`: it's the mechanism that makes a
                        // suggestion row selectable by both click and arrow-keys-then-Return,
                        // and a bare Button here is unreliable anyway — since macOS 26 an
                        // NSGlassContainerView swallows mouse events for interactive SwiftUI
                        // views layered over the title-bar/toolbar area, which is exactly where
                        // this popover sits. Selecting a row puts the completion in the field
                        // and submits, which `onSubmit(of: .search)` below turns back into a hit.
                        SiteSearchSuggestionRow(hit: hit)
                            .searchCompletion(hit.path)
                    }
                }
            }
            // Fires both for a selected suggestion (the completion above) and for a bare Return
            // in the field; `SiteSearchModel.submit` distinguishes them.
            .onSubmit(of: .search) {
                if let hit = model.submit() { activate(hit) }
            }
            // `.task(id:)` over the query+scope pair: SwiftUI cancels the in-flight search on
            // every change, which is what implements both the debounce and the staleness guard
            // inside `SiteSearchModel.search`.
            .task(id: model.request) { await model.search(siteID: siteID) }
            .focusedSceneValue(\.siteSearchActions, SiteSearchActions(
                focusSearchField: {
                    // Activating the search field inserts the scope bar — a toolbar re-layout
                    // that, coalesced with a still-presented window inspector, hits the same
                    // macOS 27 beta AppKit constraint-update storm as the pane-switch case
                    // (#1126). Dismiss the inspector and give its own dismissal transaction a
                    // moment to settle first, same mitigation as
                    // `SiteWindowModel.clearInspectorThenSwitchPane`; skipped entirely when
                    // there's no inspector presented to collide with.
                    guard inspectorPresented.wrappedValue else {
                        searchFieldFocused = true
                        return
                    }
                    inspectorPresented.wrappedValue = false
                    Task {
                        try? await Task.sleep(for: .milliseconds(300))
                        searchFieldFocused = true
                    }
                }
            ))
    }
}

/// One row in the search suggestions list: what it is, what it's called, where it lives, and why
/// it matched.
struct SiteSearchSuggestionRow: View {
    let hit: SiteSearchIndex.Hit

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: hit.kind.symbolName)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(displayTitle)
                        .lineLimit(1)
                    // The route is the more meaningful locator when there is one — it's what the
                    // user typed into a browser — so the file path only stands in for the
                    // components, styles, and config that have no route.
                    Text(hit.route ?? hit.path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if !hit.matchContext.isEmpty {
                    Text(hit.matchContext)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    /// Components, styles, and config files carry no front-matter title; the filename is what the
    /// user knows them by.
    private var displayTitle: String {
        if let title = hit.title, !title.isEmpty { return title }
        return (hit.path as NSString).lastPathComponent
    }
}

extension SiteSearchScope {
    /// Localized in the app target, not alongside `kinds` in AnglesiteCore: only
    /// `Sources/AnglesiteApp` feeds the String Catalog extractor (and CI's
    /// `check-localization-catalog.sh`).
    var title: LocalizedStringKey {
        switch self {
        case .all: LocalizedStringKey("All")
        case .pages: LocalizedStringKey("Pages")
        case .posts: LocalizedStringKey("Posts")
        case .components: LocalizedStringKey("Components")
        case .styles: LocalizedStringKey("Styles")
        }
    }
}

extension SiteKnowledgeIndex.Document.Kind {
    /// Mirrors the Site Graph Explorer's visual vocabulary so the same thing looks the same in
    /// both surfaces.
    var symbolName: String {
        switch self {
        case .page: "doc.richtext"
        case .post, .content: "text.alignleft"
        case .component: "puzzlepiece.extension"
        case .layout: "square.stack"
        case .style: "paintbrush"
        case .config: "gearshape"
        case .script: "curlybraces"
        case .other: "doc"
        }
    }
}
