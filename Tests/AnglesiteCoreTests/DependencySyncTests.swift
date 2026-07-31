import Testing
@testable import AnglesiteCore

@Suite struct DependencySyncTests {
    @Test func offersABumpWhenSiteMatchesBaselineButTemplateMovedForward() {
        let offers = DependencySync.diff(
            site: ["astro": "^5.0.0"],
            baseline: ["astro": "^5.0.0"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func leavesAUserCustomizedPackageAlone() {
        // Site's range no longer matches the baseline -> the user edited it deliberately.
        let offers = DependencySync.diff(
            site: ["astro": "^5.1.0"],
            baseline: ["astro": "^5.0.0"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.isEmpty)
    }

    @Test func doesNothingWhenSiteBaselineAndTemplateAllAgree() {
        let offers = DependencySync.diff(
            site: ["astro": "^6.4.8"],
            baseline: ["astro": "^6.4.8"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.isEmpty)
    }

    @Test func legacySiteWithNoBaselineFallsBackToADirectDiff() {
        let offers = DependencySync.diff(
            site: ["astro": "^5.0.0"],
            baseline: nil,
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func neverOffersToRemoveAPackageTheTemplateNoLongerHas() {
        let offers = DependencySync.diff(
            site: ["some-deprecated-package": "^1.0.0"],
            baseline: ["some-deprecated-package": "^1.0.0"],
            template: [:]
        )
        #expect(offers.isEmpty)
    }

    @Test func skipsAnIncomparableVersionRatherThanGuessing() {
        let offers = DependencySync.diff(
            site: ["astro": "workspace:*"],
            baseline: ["astro": "workspace:*"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.isEmpty)
    }

    @Test func handlesMultiplePackagesSortedByName() {
        let offers = DependencySync.diff(
            site: ["astro": "^5.0.0", "tsx": "^3.0.0"],
            baseline: ["astro": "^5.0.0", "tsx": "^3.0.0"],
            template: ["astro": "^6.4.8", "tsx": "^4.0.0"]
        )
        #expect(offers.updates == [
            DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8"),
            DependencyUpdateOffer(name: "tsx", currentRange: "^3.0.0", offeredRange: "^4.0.0"),
        ])
    }

    @Test func offersToAddANewPackageWhenBaselineHasNoRecordOfIt() {
        // Baseline present but never saw this name -> nothing of the owner's to
        // have deliberately removed, safe to offer (#1108).
        let offers = DependencySync.diff(
            site: [:],
            baseline: [:],
            template: ["astro-embed": "^0.13.0"]
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)])
        #expect(offers.updates.isEmpty)
    }

    @Test func offersToAddANewPackageWhenThereIsNoBaselineAtAll() {
        let offers = DependencySync.diff(
            site: [:],
            baseline: nil,
            template: ["html-validate": "^11.6.0"]
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .dependencies)])
    }

    @Test func withholdsAnAdditionForAPackageTheSiteDeliberatelyRemoved() {
        // Baseline shows the site had this package before (e.g. a prior accepted
        // addition offer) -> its current absence is the owner's own doing.
        let offers = DependencySync.diff(
            site: [:],
            baseline: ["astro-embed": "^0.13.0"],
            template: ["astro-embed": "^0.14.0"]
        )
        #expect(offers.additions.isEmpty)
    }

    @Test func tagsAnAdditionAsADevDependencyWhenTheTemplateHasItThere() {
        let offers = DependencySync.diff(
            site: [:],
            baseline: [:],
            template: ["html-validate": "^11.6.0"],
            templateDevDependencyNames: ["html-validate"]
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)])
    }

    @Test func handlesMultipleAdditionsSortedByName() {
        let offers = DependencySync.diff(
            site: [:],
            baseline: [:],
            template: ["html-validate": "^11.6.0", "astro-embed": "^0.13.0"]
        )
        #expect(offers.additions == [
            DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies),
            DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .dependencies),
        ])
    }
}
