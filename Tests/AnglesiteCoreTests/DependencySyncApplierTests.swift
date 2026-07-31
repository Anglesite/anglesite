import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct DependencySyncApplierTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static let packageJSON = """
    { "dependencies": { "astro": "^5.0.0" }, "devDependencies": {} }
    """

    private func makeSourceAndConfig() throws -> (source: URL, config: URL) {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try Self.packageJSON.write(to: source.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        try "old lockfile contents".write(to: source.appendingPathComponent("package-lock.json"), atomically: true, encoding: .utf8)
        try "ANGLESITE_VERSION=1.2.0\n".write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return (source, config)
    }

    @Test func rewritesPackageJSONWithTheAcceptedRange() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        let updated = try String(contentsOf: source.appendingPathComponent("package.json"), encoding: .utf8)
        #expect(updated.contains("\"astro\": \"^6.4.8\""))
    }

    @Test func writesAnAcceptedAdditionIntoTheCorrectSection() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(additions: [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        let updated = try String(contentsOf: source.appendingPathComponent("package.json"), encoding: .utf8)
        #expect(updated.contains("\"html-validate\": \"^11.6.0\""))
    }

    @Test func deletesTheStaleLockfile() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        #expect(!FileManager.default.fileExists(atPath: source.appendingPathComponent("package-lock.json").path))
    }

    @Test func savesTheNewBaselineWithBothAcceptedUpdatesAndAdditions() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(
            updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")],
            additions: [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)]
        )
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        #expect(DependencyBaseline.load(from: config) == ["astro": "^6.4.8", "html-validate": "^11.6.0"])
    }

    @Test func bumpsTheAnglesiteVersionStamp() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        let siteConfig = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "ANGLESITE_VERSION", in: siteConfig) == "1.4.0")
    }

    @Test func withholdsTheBaselineForAnAdditionThatDidNotLandBecauseItsSectionIsMissing() throws {
        // No `devDependencies` key at all -> `PackageJSONDependencies.applyAdditions`
        // silently drops a `.devDependencies`-targeted offer (Task 1 behavior,
        // unchanged here). Baselining it anyway would make the next `diff` call
        // think the site already has it and withhold the offer forever, with no
        // way for the user to ever see or accept it (#1108 review).
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try """
        { "dependencies": { "astro": "^5.0.0" } }
        """.write(to: source.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        try "ANGLESITE_VERSION=1.2.0\n".write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let offers = DependencySyncOffers(
            updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")],
            additions: [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)]
        )
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")

        let updated = try String(contentsOf: source.appendingPathComponent("package.json"), encoding: .utf8)
        #expect(!updated.contains("html-validate"))

        let baseline = DependencyBaseline.load(from: config)
        #expect(baseline?["astro"] == "^6.4.8")
        #expect(baseline?["html-validate"] == nil)
    }

    @Test func withholdsTheBaselineForAnUpdateThatDidNotLandBecauseItsNameIsAbsent() throws {
        // "does-not-exist" isn't a key in the site's package.json at all, so
        // `PackageJSONDependencies.apply` silently no-ops on that offer (by
        // design — it never adds anything). Baselining it anyway would claim the
        // site is at the new range while package.json never changed, and
        // `DependencySync.diff`'s `baselineRange == siteRange` bump gate would then
        // fail forever, permanently suppressing that package's future bump offers
        // (#1108 review).
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8"),
            DependencyUpdateOffer(name: "does-not-exist", currentRange: "^1.0.0", offeredRange: "^2.0.0"),
        ])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")

        let updated = try String(contentsOf: source.appendingPathComponent("package.json"), encoding: .utf8)
        #expect(!updated.contains("does-not-exist"))

        let baseline = DependencyBaseline.load(from: config)
        #expect(baseline?["astro"] == "^6.4.8")
        #expect(baseline?["does-not-exist"] == nil)
    }

    @Test func seedsTheFullBaselineFromExistingDependenciesWhenNoBaselineFileExisted() throws {
        // A legacy/imported site with no baseline file at all must not end up
        // with a baseline containing only the just-accepted offer's name(s) —
        // that would silently disable future bump offers for every other
        // dependency the site has, since `DependencySync.diff`'s bump path
        // requires `guard let baselineRange = baseline[name]` to succeed
        // (#1108 review). Mirrors `SiteScaffolder`'s scaffold-time baseline seed.
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try """
        {
          "dependencies": { "astro": "^5.0.0", "@astrojs/rss": "^4.0.0" },
          "devDependencies": { "typescript": "^5.9.3" }
        }
        """.write(to: source.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        try "ANGLESITE_VERSION=1.2.0\n".write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        // Deliberately no DependencyBaseline.save call — no baseline file exists.

        let offers = DependencySyncOffers(updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")

        let baseline = DependencyBaseline.load(from: config)
        #expect(baseline?["astro"] == "^6.4.8")
        #expect(baseline?["@astrojs/rss"] == "^4.0.0")
        #expect(baseline?["typescript"] == "^5.9.3")
    }

    @Test func throwsReadFailedWhenPackageJSONIsMissing() throws {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        #expect(throws: DependencySyncApplier.ApplyError.readFailed) {
            try DependencySyncApplier.apply(DependencySyncOffers(), sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        }
    }
}
