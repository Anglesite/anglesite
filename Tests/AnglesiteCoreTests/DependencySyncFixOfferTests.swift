import Foundation
import Testing
@testable import AnglesiteCore

@Suite("DependencySync.fixOffer (#975)")
struct DependencySyncFixOfferTests {
    private static let alertURL = URL(string: "https://github.com/acme/site/security/dependabot/1")!

    private func alert(package: String = "left-pad", patchedVersion: String?) -> DependabotAlert {
        DependabotAlert(id: 1, packageName: package, ecosystem: "npm", severity: .high,
                         patchedVersion: patchedVersion, htmlURL: Self.alertURL)
    }

    @Test("nil when the alert has no known patched version")
    func noPatchedVersion() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: nil), in: offers) == nil)
    }

    @Test("nil when the package isn't in the offered updates at all")
    func packageNotOffered() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "some-other-package", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == nil)
    }

    @Test("nil when the offered range is still behind the patched version")
    func offerStillBehindPatch() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.1.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == nil)
    }

    @Test("nil when the patched version string can't be parsed — never guess")
    func unparseablePatchedVersion() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "latest"), in: offers) == nil)
    }

    @Test("returns the matching offer when the offered range reaches the patched version")
    func matchWhenOfferReachesPatch() {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        let offers = DependencySyncOffers(updates: [offer])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == offer)
    }

    @Test("returns the matching offer when the offered range exceeds the patched version")
    func matchWhenOfferExceedsPatch() {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^2.0.0")
        let offers = DependencySyncOffers(updates: [offer])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == offer)
    }
}
