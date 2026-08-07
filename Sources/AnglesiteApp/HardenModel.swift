import SwiftUI
import AnglesiteCore

@MainActor
@Observable
final class HardenModel {
    enum Phase: Equatable {
        case idle
        case resolvingZone(domain: String)
        case preview(plan: HardenPlan, domain: String, zoneID: String)
        case applying(plan: HardenPlan, domain: String)
        case succeeded(result: HardenResult)
        case failed(reason: String)
    }

    struct HardenResult: Equatable {
        let appliedCount: Int
        let failedItems: [FailedItem]
        let postAuditFindings: [AuditReport.Finding]
        let auditError: String?

        struct FailedItem: Equatable {
            let description: String
            let error: String
        }
    }

    private(set) var phase: Phase = .idle
    var sheetPresented: Bool = false
    var domainInput: String = ""

    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting
    private let keychain: any SecretStore
    private var inFlight: Task<Void, Never>?

    private var currentSite: CurrentSite?

    init(
        reader: any CloudflareReading = HTTPCloudflareClient(),
        writer: any CloudflareWriting = HTTPCloudflareClient(),
        keychain: any SecretStore = KeychainStore()
    ) {
        self.reader = reader
        self.writer = writer
        self.keychain = keychain
    }

    /// Threaded from `SiteWindowModel.loadAndStart` (#822 pattern), mirroring `DomainModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }

    var isRunning: Bool {
        switch phase {
        case .resolvingZone, .applying: return true
        default: return false
        }
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .idle
        domainInput = ""
        sheetPresented = true
    }

    func retryFromFailed() {
        guard !isRunning else { return }
        phase = .idle
        sheetPresented = true
    }

    func resolveAndPlan() {
        let domain = domainInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !domain.isEmpty else { return }
        guard !isRunning else { return }

        // Flip out of .idle/.preview synchronously, before the Task (and its `await apiToken()`
        // hop, which can now do a real OAuth-refresh network round trip) even starts — matching
        // DomainConfigAuditModel's runAudit()/reconcile(), so isRunning can't under-report while a
        // token resolves (#1211 review).
        phase = .resolvingZone(domain: domain)

        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runResolveAndPlan(domain: domain)
        }
    }

    func apply() {
        guard case .preview(let plan, let domain, let zoneID) = phase else { return }
        guard !plan.isEmpty else { return }

        // Flip to .applying synchronously before the Task starts (see resolveAndPlan()'s comment)
        // — this also closes a double-click hole: apply()'s only guard was `case .preview = phase`
        // with no isRunning check, so a second click while the token was still resolving used to
        // pass the same guard, cancel `inFlight`, and silently restart (#1211 review).
        phase = .applying(plan: plan, domain: domain)

        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runApply(plan: plan, domain: domain, zoneID: zoneID)
        }
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
        phase = .idle
    }

    // MARK: - Private

    private func apiToken() async -> String? {
        try? await CloudflareAPICredentials.resolve(secretStore: keychain)
    }

    private func runResolveAndPlan(domain: String) async {
        guard let token = await apiToken() else {
            phase = .failed(reason: "No Cloudflare API token found. Add one in Settings → Credentials.")
            return
        }

        do {
            guard let zoneID = try await reader.resolveZoneID(domain: domain, apiToken: token) else {
                phase = .failed(reason: "Zone not found for \"\(domain)\". Check the domain and ensure your API token has Zone Read permission.")
                return
            }

            let state = try await reader.zoneState(zoneID: zoneID, domain: domain, apiToken: token)
            let plan = HardenPlanner.plan(from: state, domain: domain)
            phase = .preview(plan: plan, domain: domain, zoneID: zoneID)
        } catch let error as CloudflareError {
            phase = .failed(reason: cloudflareErrorMessage(error, domain: domain))
        } catch {
            phase = .failed(reason: "Failed to read zone state: \(error.localizedDescription)")
        }
    }

    private func runApply(plan: HardenPlan, domain: String, zoneID: String) async {
        guard let token = await apiToken() else {
            phase = .failed(reason: "No Cloudflare API token found.")
            return
        }

        let executor = HardenExecutor(reader: reader, writer: writer)
        let result = await executor.execute(
            plan: plan, zoneID: zoneID, domain: domain, apiToken: token,
            sourceDirectory: currentSite?.sourceDirectory)

        phase = .succeeded(result: HardenResult(
            appliedCount: result.appliedCount,
            failedItems: result.failedItems.map { .init(description: $0.item.description, error: $0.error) },
            postAuditFindings: result.postAuditFindings,
            auditError: result.auditError
        ))
    }

    private func cloudflareErrorMessage(_ error: CloudflareError, domain: String) -> String {
        switch error {
        case .unauthorized:
            return "API token is unauthorized. Check that it has Zone Read, DNS Read, and Zone Settings Read permissions."
        case .http(let status):
            return "Cloudflare API returned HTTP \(status)."
        case .api(let message):
            return "Cloudflare API error: \(message)"
        case .malformedResponse:
            return "Unexpected response from Cloudflare API."
        }
    }
}
