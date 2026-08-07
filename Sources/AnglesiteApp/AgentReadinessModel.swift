import SwiftUI
import AnglesiteCore

/// App-layer glue for #1248: fetches Cloudflare's Agent Readiness score for this site's deployed
/// URL and translates its checks into owner-friendly language. Mirrors `DomainConfigAuditModel`'s
/// shape (no user input — the target is resolved from the site itself, not typed in), simplified
/// to a single async step since there's nothing here to apply/reconcile, only to read.
@MainActor
@Observable
final class AgentReadinessModel {
    enum Phase: Equatable {
        case idle
        case scanning(url: URL)
        case succeeded(report: AgentReadinessReport, scannedURL: URL)
        case failed(reason: String)
    }

    private(set) var phase: Phase = .idle
    var sheetPresented: Bool = false

    private let scanner: any AgentReadinessScanning
    private let tokenSource: DeployCommand.TokenSource
    private var inFlight: Task<Void, Never>?

    private var currentSite: CurrentSite?

    init(
        scanner: any AgentReadinessScanning = HTTPCloudflareClient(),
        tokenSource: @escaping DeployCommand.TokenSource = DeployCommand.keychainTokenSource
    ) {
        self.scanner = scanner
        self.tokenSource = tokenSource
    }

    /// Threaded from `SiteWindowModel.loadAndStart`, mirroring `HardenModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }

    var isRunning: Bool {
        if case .scanning = phase { return true }
        return false
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .idle
        sheetPresented = true
    }

    func retryFromFailed() {
        guard !isRunning else { return }
        phase = .idle
    }

    /// Validates synchronously (site open, deployed URL known) and, only once that succeeds,
    /// flips `phase` to `.scanning` before spawning the network task — same
    /// synchronous-then-async split as `DomainConfigAuditModel.runAudit()`, so a caller polling
    /// `isRunning` right after calling this never races the task's own first `phase` write.
    func runScan() {
        guard !isRunning else { return }
        guard let site = currentSite else {
            phase = .failed(reason: "No site is open.")
            return
        }
        guard let urlString = DeployCoordinator.resolveSiteURL(siteDirectory: site.sourceDirectory),
              let url = URL(string: urlString) else {
            phase = .failed(reason: "This site hasn't been published yet. Publish it first, then check its Agent Readiness score.")
            return
        }

        phase = .scanning(url: url)

        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.performScan(url: url)
        }
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
        phase = .idle
    }

    // MARK: - Private

    private func performScan(url: URL) async {
        do {
            guard let token = try await tokenSource() else {
                phase = .failed(reason: "No Cloudflare API token found. Add one in Settings → Credentials.")
                return
            }
            let scanID = try await scanner.submitAgentReadinessScan(url: url, apiToken: token)
            guard let report = try await poll(scanID: scanID, apiToken: token) else {
                if !Task.isCancelled {
                    phase = .failed(reason: "The scan didn't finish in time. Try again in a moment.")
                }
                return
            }
            guard !Task.isCancelled else { return }
            phase = .succeeded(report: report, scannedURL: url)
        } catch let error as CloudflareError {
            phase = .failed(reason: Self.message(for: error))
        } catch {
            if !Task.isCancelled {
                phase = .failed(reason: "Couldn't check Agent Readiness: \(error.localizedDescription)")
            }
        }
    }

    /// Polls every 3s, up to 20 times (~60s). A full Agent Readiness pass (page render plus 14
    /// checks) is slower than the Registrar's 15s registration poll elsewhere in this codebase,
    /// so this window is wider. Returns `nil` — not an error — on a cancelled task or a timeout;
    /// both are "try again", not "something's wrong".
    private func poll(scanID: UUID, apiToken: String) async throws -> AgentReadinessReport? {
        for _ in 0..<20 {
            if Task.isCancelled { return nil }
            if let report = try await scanner.agentReadinessResult(scanID: scanID, apiToken: apiToken) {
                return report
            }
            try? await Task.sleep(for: .seconds(3))
        }
        return nil
    }

    private static func message(for error: CloudflareError) -> String {
        switch error {
        case .unauthorized:
            return "API token is unauthorized. Check that it has Account Settings Read permission."
        case .http(let status):
            return "Cloudflare API returned HTTP \(status)."
        case .api(let message):
            return "Cloudflare API error: \(message)"
        case .malformedResponse:
            return "Unexpected response from Cloudflare API."
        }
    }
}
