import Testing
import Foundation
@testable import AnglesiteCore

@Suite("AdvisoryForwarding (#975)")
struct AdvisoryForwardingTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")
    private static let advisory = SecurityAdvisory(
        id: "GHSA-xxxx-yyyy-zzzz", summary: "Reflected XSS in the search page", severity: .high,
        htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-xxxx-yyyy-zzzz")!,
        publishedAt: nil)

    @Test("the form URL points at Anglesite/Anglesite's own advisory intake")
    func formURL() {
        #expect(AdvisoryForwarding.anglesiteAdvisoryFormURL
            == URL(string: "https://github.com/Anglesite/Anglesite/security/advisories/new"))
    }

    @Test("clipboard text includes the advisory title, its GHSA URL, and the originating site repo")
    func clipboardTextIncludesExpectedFields() {
        let text = AdvisoryForwarding.clipboardText(for: Self.advisory, siteRepo: Self.repo)
        #expect(text.contains("Reflected XSS in the search page"))
        #expect(text.contains("https://github.com/acme/site/security/advisories/GHSA-xxxx-yyyy-zzzz"))
        #expect(text.contains("acme/site"))
    }

    @Test("clipboard text never includes anything beyond the advisory's own public title and URL")
    func clipboardTextIsBoundedToPublicFields() {
        // Regression guard: a future field addition (e.g. a private description) must not
        // silently start flowing into this clipboard text without a deliberate decision — see
        // the design doc's "Validation ownership"-equivalent note on forwarding scope.
        let text = AdvisoryForwarding.clipboardText(for: Self.advisory, siteRepo: Self.repo)
        let expectedFragments = [Self.advisory.summary, Self.advisory.htmlURL.absoluteString, "acme/site"]
        let withoutExpectedFragments = expectedFragments.reduce(text) { $0.replacingOccurrences(of: $1, with: "") }
        // What's left is boilerplate labels/punctuation only — assert it's short, not empty,
        // since some connecting words ("found while triaging reports against…") are expected.
        #expect(withoutExpectedFragments.count < 120)
    }
}
