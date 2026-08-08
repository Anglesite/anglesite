import Foundation
import Testing
import AnglesiteCore
@testable import AnglesiteAppCore

private final class StubScanner: AgentReadinessScanning, @unchecked Sendable {
    private let scanID: UUID
    private let pollSequence: [AgentReadinessReport?]
    private let submitError: Error?
    private(set) var submittedURL: URL?
    private(set) var submittedToken: String?
    private var pollIndex = 0

    init(scanID: UUID = UUID(), pollSequence: [AgentReadinessReport?] = [], submitError: Error? = nil) {
        self.scanID = scanID
        self.pollSequence = pollSequence
        self.submitError = submitError
    }

    func submitAgentReadinessScan(url: URL, apiToken: String) async throws -> UUID {
        submittedURL = url
        submittedToken = apiToken
        if let submitError { throw submitError }
        return scanID
    }

    func agentReadinessResult(scanID: UUID, apiToken: String) async throws -> AgentReadinessReport? {
        defer { pollIndex = min(pollIndex + 1, pollSequence.count - 1) }
        guard !pollSequence.isEmpty else { return nil }
        return pollSequence[min(pollIndex, pollSequence.count - 1)]
    }
}

private let sampleReport = AgentReadinessReport(
    level: 2, levelName: "Bot-Aware",
    categories: [
        .init(id: "discoverability", displayName: "Discoverability", checks: [
            .init(id: "robotsTxt", displayName: "Crawling rules (robots.txt)", status: .pass,
                  hint: "AI agents can find your site's crawling rules.", anglesiteProvides: true),
        ]),
    ],
    nextLevel: nil)

/// `.timeLimit`: see #1349 — the full `AnglesiteAppTests` target has hung indefinitely under
/// local machine contention (many concurrent `swift test` runs oversubscribing the cooperative
/// thread pool), with this suite one of the observed stall points. A wedged test now fails as an
/// unambiguous time-limit violation instead of hanging the whole run forever.
@Suite(.serialized, .timeLimit(.minutes(1)))
struct AgentReadinessModelTests {
    private func tempSite(siteURL: String? = "https://example.workers.dev") throws -> (CurrentSite, () -> Void) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        if let siteURL {
            try "SITE_URL=\(siteURL)\n".write(
                to: tmp.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        }
        let site = CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp)
        return (site, { try? FileManager.default.removeItem(at: tmp) })
    }

    @MainActor
    @Test("runScan() fails clearly when no site is open")
    func runScanNoSite() async {
        let model = AgentReadinessModel(scanner: StubScanner(), tokenSource: { "token" })
        model.runScan()
        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("No site is open"))
    }

    @MainActor
    @Test("runScan() fails clearly when the site has no known deployed URL")
    func runScanNoDeployedURL() async throws {
        let (site, cleanup) = try tempSite(siteURL: nil)
        defer { cleanup() }
        let model = AgentReadinessModel(scanner: StubScanner(), tokenSource: { "token" })
        model.configure(site: site)

        model.runScan()

        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("published"))
    }

    @MainActor
    @Test("runScan() fails clearly when no Cloudflare token is available")
    func runScanNoToken() async throws {
        let (site, cleanup) = try tempSite()
        defer { cleanup() }
        let model = AgentReadinessModel(scanner: StubScanner(), tokenSource: { nil })
        model.configure(site: site)

        model.runScan()
        while model.isRunning { await Task.yield() }

        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("No Cloudflare API token"))
    }

    @MainActor
    @Test("runScan() submits the site's resolved URL and surfaces the polled report")
    func runScanSucceeds() async throws {
        let (site, cleanup) = try tempSite()
        defer { cleanup() }
        let scanner = StubScanner(pollSequence: [sampleReport])
        let model = AgentReadinessModel(scanner: scanner, tokenSource: { "token" })
        model.configure(site: site)

        model.runScan()
        while model.isRunning { await Task.yield() }

        #expect(scanner.submittedURL == URL(string: "https://example.workers.dev"))
        #expect(scanner.submittedToken == "token")
        guard case .succeeded(let report, let scannedURL) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)")
            return
        }
        #expect(report == sampleReport)
        #expect(scannedURL == URL(string: "https://example.workers.dev"))
    }

    @MainActor
    @Test("runScan() surfaces a Cloudflare API error")
    func runScanCloudflareError() async throws {
        let (site, cleanup) = try tempSite()
        defer { cleanup() }
        let scanner = StubScanner(submitError: CloudflareError.unauthorized)
        let model = AgentReadinessModel(scanner: scanner, tokenSource: { "token" })
        model.configure(site: site)

        model.runScan()
        while model.isRunning { await Task.yield() }

        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("unauthorized"))
    }

    @MainActor
    @Test("openSheet() resets phase and presents")
    func openSheetResets() {
        let model = AgentReadinessModel(scanner: StubScanner(), tokenSource: { "token" })
        model.openSheet()
        #expect(model.sheetPresented == true)
        #expect(model.phase == .idle)
    }

    @MainActor
    @Test("dismissSheet() clears the presented flag and resets phase")
    func dismissSheetClearsPresented() {
        let model = AgentReadinessModel(scanner: StubScanner(), tokenSource: { "token" })
        model.openSheet()
        model.dismissSheet()
        #expect(model.sheetPresented == false)
        #expect(model.phase == .idle)
    }
}
