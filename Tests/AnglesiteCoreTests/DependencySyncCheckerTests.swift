import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct DependencySyncCheckerTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func makeSite(siteConfig: String?, packageJSON: String, baseline: [String: String]?) throws -> (source: URL, config: URL) {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try writeFile(packageJSON, to: source.appendingPathComponent("package.json"))
        if let siteConfig {
            try writeFile(siteConfig, to: source.appendingPathComponent(".site-config"))
        }
        if let baseline {
            try DependencyBaseline.save(baseline, to: config)
        }
        return (source, config)
    }

    private func makeTemplate(packageJSON: String) throws -> URL {
        let dir = tmpDir()
        try writeFile(packageJSON, to: dir.appendingPathComponent("package.json"))
        return dir
    }

    private static let stalePackageJSON = """
    { "dependencies": { "astro": "^5.0.0" } }
    """
    private static let currentTemplatePackageJSON = """
    { "dependencies": { "astro": "^6.4.8" } }
    """

    @Test func fastPathSkipsEverythingWhenStampedVersionMatchesRunningVersion() throws {
        let (source, config) = try makeSite(
            siteConfig: "ANGLESITE_VERSION=1.4.0\n",
            packageJSON: Self.stalePackageJSON,  // deliberately stale, to prove the fast path never looks
            baseline: nil
        )
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.isEmpty)
    }

    @Test func fallsThroughToTheRealDiffWhenStampedVersionDiffers() throws {
        let (source, config) = try makeSite(
            siteConfig: "ANGLESITE_VERSION=1.2.0\n",
            packageJSON: Self.stalePackageJSON,
            baseline: ["astro": "^5.0.0"]
        )
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func fallsThroughWhenThereIsNoSiteConfigAtAll() throws {
        let (source, config) = try makeSite(siteConfig: nil, packageJSON: Self.stalePackageJSON, baseline: nil)
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func returnsEmptyRatherThanThrowingWhenPackageJSONIsMissing() throws {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.isEmpty)
    }

    @Test func surfacesANewTemplateDevDependencyAsAnAdditionOffer() throws {
        let (source, config) = try makeSite(
            siteConfig: "ANGLESITE_VERSION=1.2.0\n",
            packageJSON: """
            { "dependencies": { "astro": "^6.4.8" }, "devDependencies": {} }
            """,
            baseline: ["astro": "^6.4.8"]
        )
        let template = try makeTemplate(packageJSON: """
        { "dependencies": { "astro": "^6.4.8" }, "devDependencies": { "html-validate": "^11.6.0" } }
        """)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)])
    }
}
