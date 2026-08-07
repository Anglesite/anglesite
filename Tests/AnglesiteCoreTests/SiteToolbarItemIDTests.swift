import Testing
@testable import AnglesiteCore

struct SiteToolbarItemIDTests {
    /// The site-window toolbar item ids are API: macOS persists user toolbar customizations keyed
    /// by these strings, so a rename silently discards every user's saved layout (#519). This test
    /// freezes the exact set — if it fails, you are breaking saved customizations; only proceed
    /// with a deliberate migration story, then update the expectation.
    @Test func toolbarItemIDsAreFrozen() {
        #expect(SiteToolbarItemID.allCases.map(\.rawValue) == [
            "panes",
            "graph",
            "backup",
            "audit",
            "openInBrowser",
            "harden",
            "domainConfigAudit",
            "agentReadiness",
            "onionRouting",
            "domain",
            "integration",
            "siriReadiness",
            "relatedPages",
            "github",
            "deploy",
            "chat",
            "inspector",
            "styleGuide",
            "sync",
        ])
    }
}
