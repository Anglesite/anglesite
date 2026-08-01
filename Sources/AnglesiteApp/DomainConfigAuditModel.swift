import SwiftUI
import AnglesiteCore

/// App-layer glue for the #1171 drift audit: reads the site's declared `Source/anglesite.json`,
/// resolves its declared domain against live Cloudflare state, and offers one-click reconciliation
/// for the unambiguous app-owned drift `DomainConfigAudit` finds — mirroring `HardenModel`'s
/// resolve → plan → apply → re-audit shape (investigation doc §5.5: "remediation reuses the
/// Harden idiom"). Unlike `HardenModel`, the domain comes from the declaration itself, not a
/// text field: there's nothing useful to audit without one.
@MainActor
@Observable
final class DomainConfigAuditModel {
    enum Phase: Equatable {
        case idle
        case auditing(domain: String)
        case results(findings: [DomainConfigAudit.Finding], plan: DomainConfigReconcilePlan, domain: String, zoneID: String)
        case reconciling(domain: String)
        case succeeded(result: ReconcileResult)
        case failed(reason: String)
    }

    struct ReconcileResult: Equatable {
        let appliedCount: Int
        let failedItems: [FailedItem]
        let postAuditFindings: [DomainConfigAudit.Finding]
        let auditError: String?

        struct FailedItem: Equatable {
            let description: String
            let error: String
        }
    }

    private(set) var phase: Phase = .idle
    var sheetPresented: Bool = false

    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting
    private let keychain: KeychainStore
    private var inFlight: Task<Void, Never>?

    private var currentSite: CurrentSite?

    init(
        reader: any CloudflareReading = HTTPCloudflareClient(),
        writer: any CloudflareWriting = HTTPCloudflareClient(),
        keychain: KeychainStore = KeychainStore()
    ) {
        self.reader = reader
        self.writer = writer
        self.keychain = keychain
    }

    /// Threaded from `SiteWindowModel.loadAndStart`, mirroring `HardenModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }

    var isRunning: Bool {
        switch phase {
        case .auditing, .reconciling: return true
        default: return false
        }
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

    /// Validates synchronously (site open, declared domain present, token available) and, only
    /// once that succeeds, flips `phase` to `.auditing` *before* spawning the network task — so a
    /// caller that immediately checks `isRunning` (a synchronous poll loop, e.g. in tests) always
    /// observes the running state rather than racing the task's own first `phase` write.
    func runAudit() {
        guard !isRunning else { return }
        guard let site = currentSite else {
            phase = .failed(reason: "No site is open.")
            return
        }

        let declared: DomainConfig
        do {
            declared = try DomainConfigStore(sourceDirectory: site.sourceDirectory).load()
        } catch {
            phase = .failed(reason: "anglesite.json couldn't be read: \(error.localizedDescription)")
            return
        }
        guard let domain = declared.domain?.hostname, !domain.isEmpty else {
            phase = .failed(reason: "No domain is declared in anglesite.json yet. Attach a domain first.")
            return
        }
        guard let token = apiToken() else {
            phase = .failed(reason: "No Cloudflare API token found. Add one in Settings → Credentials.")
            return
        }

        phase = .auditing(domain: domain)

        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.performAudit(declared: declared, domain: domain, token: token)
        }
    }

    /// Same synchronous-then-async split as ``runAudit()``, for the same reason.
    func reconcile() {
        guard case .results(_, let plan, let domain, let zoneID) = phase, !plan.isEmpty else { return }
        guard let site = currentSite else {
            phase = .failed(reason: "No site is open.")
            return
        }
        guard let token = apiToken() else {
            phase = .failed(reason: "No Cloudflare API token found.")
            return
        }
        let declared = (try? DomainConfigStore(sourceDirectory: site.sourceDirectory).load()) ?? DomainConfig()

        phase = .reconciling(domain: domain)

        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.performReconcile(plan: plan, domain: domain, zoneID: zoneID, declared: declared, token: token)
        }
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
        phase = .idle
    }

    // MARK: - Private

    private func apiToken() -> String? {
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            return env
        }
        return try? keychain.readCloudflareToken()
    }

    private func performAudit(declared: DomainConfig, domain: String, token: String) async {
        do {
            guard let zoneID = try await reader.resolveZoneID(domain: domain, apiToken: token) else {
                phase = .failed(reason: "Zone not found for \"\(domain)\". Check the domain and ensure your API token has Zone Read permission.")
                return
            }

            let state = try await reader.zoneState(zoneID: zoneID, domain: domain, apiToken: token)
            let records = try await reader.listDNSRecords(zoneID: zoneID, apiToken: token)
            let findings = DomainConfigAudit.evaluate(
                declared: declared, live: state, liveDNSRecords: records, domain: domain)
            let planItems = findings.compactMap { finding -> DomainConfigReconcileItem? in
                guard case .autoApply(let item) = finding.remediation else { return nil }
                return item
            }
            phase = .results(
                findings: findings, plan: DomainConfigReconcilePlan(items: planItems),
                domain: domain, zoneID: zoneID)
        } catch let error as CloudflareError {
            phase = .failed(reason: cloudflareErrorMessage(error, domain: domain))
        } catch {
            phase = .failed(reason: "Failed to read zone state: \(error.localizedDescription)")
        }
    }

    private func performReconcile(
        plan: DomainConfigReconcilePlan, domain: String, zoneID: String, declared: DomainConfig, token: String
    ) async {
        let reconciler = DomainConfigReconciler(reader: reader, writer: writer)
        let result = await reconciler.execute(
            plan: plan, zoneID: zoneID, domain: domain, apiToken: token, declared: declared)

        phase = .succeeded(result: ReconcileResult(
            appliedCount: result.appliedCount,
            failedItems: result.failedItems.map { .init(description: $0.item.description, error: $0.error) },
            postAuditFindings: result.postAuditFindings,
            auditError: result.auditError
        ))
    }

    private func cloudflareErrorMessage(_ error: CloudflareError, domain: String) -> String {
        switch error {
        case .unauthorized:
            return "API token is unauthorized. Check that it has Zone Read and DNS Read permissions."
        case .http(let status):
            return "Cloudflare API returned HTTP \(status)."
        case .api(let message):
            return "Cloudflare API error: \(message)"
        case .malformedResponse:
            return "Unexpected response from Cloudflare API."
        }
    }
}
