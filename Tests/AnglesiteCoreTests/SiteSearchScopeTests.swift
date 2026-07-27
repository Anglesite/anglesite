import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SiteSearchScope")
struct SiteSearchScopeTests {

    /// The case list is the toolbar search field's scope bar (#520). Freezing it here keeps a
    /// new case from silently shipping without a `kinds` mapping and a localized title.
    @Test("case set is frozen")
    func caseSetIsFrozen() {
        #expect(SiteSearchScope.allCases == [.all, .pages, .posts, .components, .styles])
    }

    /// `nil`, not the union of every kind: an explicit set would silently exclude the
    /// `.config`/`.script`/`.other` documents the index also holds, so "All" would quietly
    /// search less than all.
    @Test("all applies no kind filter")
    func allAppliesNoFilter() {
        #expect(SiteSearchScope.all.kinds == nil)
    }

    @Test("each narrowing scope maps to its document kinds")
    func narrowingScopesMapToKinds() {
        #expect(SiteSearchScope.pages.kinds == [.page])
        #expect(SiteSearchScope.posts.kinds == [.post, .content])
        #expect(SiteSearchScope.components.kinds == [.component, .layout])
        #expect(SiteSearchScope.styles.kinds == [.style])
    }

    @Test("narrowing scopes never map to an empty set")
    func narrowingScopesAreNonEmpty() {
        for scope in SiteSearchScope.allCases where scope != .all {
            #expect(scope.kinds?.isEmpty == false, "\(scope) would match nothing")
        }
    }

    /// Raw values are persisted with the window's scene state, so they're API in the same sense
    /// `SiteToolbarItemID`'s are — renaming one silently resets a user's chosen scope.
    @Test("raw values are stable")
    func rawValuesAreStable() {
        #expect(SiteSearchScope.allCases.map(\.rawValue)
            == ["all", "pages", "posts", "components", "styles"])
    }
}
