import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel RUM analytics summary (#1114)")
@MainActor
struct PlistEditorModelRUMAnalyticsTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private struct FakeRUMAnalyticsProvider: CloudflareRUMAnalyticsProviding {
        let result: Result<RUMAnalyticsSummary, Error>
        func summary(siteTag: String, apiToken: String, days: Int) async throws -> RUMAnalyticsSummary {
            try result.get()
        }
    }

    private struct Fixture {
        let model: PlistEditorModel
    }

    private func makeFixture(
        token: String? = "test-token",
        siteTag: String = "",
        rumResult: Result<RUMAnalyticsSummary, Error> = .success(
            RUMAnalyticsSummary(totalPageviews: 100, totalVisits: 40, dailyPageviews: []))
    ) async throws -> Fixture {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelRUMAnalyticsTests-\(UUID().uuidString)", isDirectory: true)
        let sourceDir = dir.appendingPathComponent("Source", isDirectory: true)
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let plistURL = sourceDir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        let keychainService = "io.dwk.anglesite.test-\(UUID().uuidString)"
        let keychain = KeychainStore(service: keychainService)
        if let token {
            try keychain.writeCloudflareToken(token)
        }
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "My Test Site",
            sourceDirectory: sourceDir,
            configDirectory: configDir,
            rumAnalyticsProvider: FakeRUMAnalyticsProvider(result: rumResult),
            keychain: keychain)
        model.analyticsSettings.cloudflareToken = siteTag
        return Fixture(model: model)
    }

    @Test("loadRUMSummary does nothing when Cloudflare Analytics is not enabled")
    func skipsWhenAnalyticsDisabled() async throws {
        let fixture = try await makeFixture(siteTag: "")

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == nil)
        #expect(fixture.model.rumSummaryError == nil)
    }

    @Test("loadRUMSummary populates rumSummary on success")
    func populatesSummaryOnSuccess() async throws {
        let summary = RUMAnalyticsSummary(
            totalPageviews: 240, totalVisits: 90,
            dailyPageviews: [DailyCount(date: Date(timeIntervalSince1970: 0), pageviews: 240)])
        let fixture = try await makeFixture(siteTag: "site-tag-1", rumResult: .success(summary))

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == summary)
        #expect(fixture.model.rumSummaryError == nil)
    }

    @Test("loadRUMSummary surfaces a provider error and clears any prior summary")
    func surfacesProviderError() async throws {
        let fixture = try await makeFixture(
            siteTag: "site-tag-1",
            rumResult: .failure(CloudflareWebAnalyticsError.api("boom")))

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == nil)
        #expect(fixture.model.rumSummaryError == "boom")
    }

    @Test("loadRUMSummary surfaces missingToken when no Cloudflare token is configured",
          .enabled(if: ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"] == nil))
    func surfacesMissingToken() async throws {
        let fixture = try await makeFixture(token: nil, siteTag: "site-tag-1")

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == nil)
        #expect(fixture.model.rumSummaryError == CloudflareWebAnalyticsError.missingToken.localizedDescription)
    }
}
