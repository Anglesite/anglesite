import SwiftUI
import AnglesiteCore

/// Drives the "Buy a Domain" sheet (#1195): search → price → confirm → purchase, reached from
/// `ConnectDomainSheetView`'s "Buy a domain" button. A successful purchase records the exact same
/// `DOMAIN_CHOICE=transfer` intent "I already own a domain" does (`ConnectDomainCommand
/// .recordTransfer`) — a Cloudflare-registered domain needs identical Workers Custom Domain
/// attach logic to a nameserver-delegated one, so `CustomDomainAttachCommand` needs no changes.
@MainActor
@Observable
final class BuyDomainModel {
    struct DomainCandidate: Equatable, Identifiable {
        var id: String { name }
        let name: String
        let registrable: Bool
        let reason: String?
        let priceDisplay: String?
    }

    enum Phase: Equatable {
        case searching(query: String)
        case loadingResults(query: String)
        case results(query: String, candidates: [DomainCandidate])
        case confirming(candidate: DomainCandidate)
        case purchasing(candidate: DomainCandidate)
        case purchased(hostname: String)
        case needsAccountSetup(hostname: String)
        case stillProcessing(hostname: String)
        case failed(reason: String)
    }

    private(set) var phase: Phase = .searching(query: "")
    var sheetPresented: Bool = false
    var queryInput: String = ""

    /// Progress of the nested token-prompt sheet, shown when a search hits `.noToken`. Presented
    /// by `BuyDomainSheetView` itself (a sheet stacked on the already-open purchase sheet), not by
    /// `SiteWindow` — see that view's doc comment.
    var tokenPromptPresented: Bool = false
    private(set) var tokenVerification: CloudflareTokenVerification = .idle
    /// The query `submitSearch()` was trying to run when `.noToken` interrupted it — re-run once
    /// the prompt reports `.proceed`.
    private var pendingSearchQuery: String?

    static let cloudflareDomainsURL = ConnectDomainModel.cloudflareDomainsURL

    private let ops: any RegistrarOperationsService
    private let keychain: KeychainStore
    private let onboarding: TokenOnboarding
    private var currentSite: CurrentSite?
    private var inFlight: Task<Void, Never>?

    init(
        ops: any RegistrarOperationsService = RegistrarOperations(),
        keychain: KeychainStore = KeychainStore(),
        verifier: TokenVerifying = CloudflareAPITokenVerifier()
    ) {
        self.ops = ops
        self.keychain = keychain
        self.onboarding = TokenOnboarding(verifier: verifier)
    }

    func configure(site: CurrentSite) {
        currentSite = site
    }

    var isRunning: Bool {
        switch phase {
        case .loadingResults, .purchasing: return true
        default: return false
        }
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .searching(query: "")
        queryInput = ""
        sheetPresented = true
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
    }

    func submitSearch() {
        let query = queryInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, !isRunning else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runSearch(query: query)
        }
    }

    func selectCandidate(_ candidate: DomainCandidate) {
        guard candidate.registrable, case .results = phase else { return }
        phase = .confirming(candidate: candidate)
    }

    func cancelConfirm() {
        guard case .confirming = phase else { return }
        phase = .searching(query: queryInput)
    }

    func confirmPurchase() {
        guard case .confirming(let candidate) = phase, !isRunning else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runPurchase(candidate: candidate)
        }
    }

    /// Called by the token-prompt sheet's submit action, mirroring `DeployModel.verifyAndSaveToken`
    /// exactly (same `TokenOnboarding` ordering, same `isCancelled` shape) — the only difference is
    /// what "proceed" means: re-running the parked search instead of starting a deploy.
    func verifyAndSaveToken(_ token: String) async {
        guard let query = pendingSearchQuery else {
            tokenVerification = .failed(message: "No search is waiting — close this and search again.")
            return
        }
        tokenVerification = .checking
        let outcome = await onboarding.run(
            token: token,
            siteDirectory: currentSite?.sourceDirectory ?? FileManager.default.temporaryDirectory,
            persist: { try keychain.writeCloudflareToken($0) },
            onConnected: { tokenVerification = .connected(accountName: $0.name) },
            delay: { try? await Task.sleep(for: .milliseconds(700)) },
            isCancelled: { Task.isCancelled || !tokenPromptPresented }
        )
        switch outcome {
        case .proceed:
            pendingSearchQuery = nil
            tokenPromptPresented = false
            tokenVerification = .idle
            queryInput = query
            submitSearch()
        case .stay(let message):
            tokenVerification = .failed(message: message)
        case .abort:
            tokenVerification = .idle
        }
    }

    func cancelTokenPrompt() {
        pendingSearchQuery = nil
        tokenPromptPresented = false
        tokenVerification = .idle
    }

    // MARK: - Private

    private func runSearch(query: String) async {
        phase = .loadingResults(query: query)
        switch await ops.searchDomains(query: query) {
        case .failure(.noToken):
            pendingSearchQuery = query
            tokenVerification = .idle
            tokenPromptPresented = true
            phase = .searching(query: query)
        case .failure(let error):
            phase = .failed(reason: message(for: error))
        case .success(let names):
            guard !names.isEmpty else {
                phase = .results(query: query, candidates: [])
                return
            }
            switch await ops.checkDomainAvailability(domains: names) {
            case .failure(let error):
                phase = .failed(reason: message(for: error))
            case .success(let checks):
                let candidates = checks.map {
                    DomainCandidate(
                        name: $0.name, registrable: $0.registrable, reason: $0.reason,
                        priceDisplay: Self.priceDisplay(cost: $0.registrationCost, currency: $0.currency))
                }
                phase = .results(query: query, candidates: candidates)
            }
        }
    }

    private func runPurchase(candidate: DomainCandidate) async {
        phase = .purchasing(candidate: candidate)
        guard let site = currentSite else {
            phase = .failed(reason: "No site is open.")
            return
        }
        switch await ops.registerDomain(name: candidate.name) {
        case .failure(let error):
            phase = .failed(reason: message(for: error))
        case .success(.succeeded):
            ConnectDomainCommand.recordTransfer(hostname: candidate.name, siteDirectory: site.sourceDirectory)
            phase = .purchased(hostname: candidate.name)
        case .success(.failed(let reason)):
            phase = .failed(reason: reason)
        case .success(.actionRequired), .success(.blocked):
            phase = .needsAccountSetup(hostname: candidate.name)
        case .success(.stillProcessing):
            phase = .stillProcessing(hostname: candidate.name)
        }
    }

    private func message(for error: RegistrarOperationError) -> String {
        switch error {
        case .noToken:
            return "No Cloudflare API token found. Add one in Settings → Credentials."
        case .cloudflare(let cfError):
            switch cfError {
            case .unauthorized:
                return "API token is unauthorized. Check that it has Registrar permissions."
            case .http(let status):
                return "Cloudflare API returned HTTP \(status)."
            case .api(let msg):
                return "Cloudflare API error: \(msg)"
            case .malformedResponse:
                return "Unexpected response from Cloudflare API."
            }
        }
    }

    private static func priceDisplay(cost: String?, currency: String?) -> String? {
        guard let cost else { return nil }
        if currency == "USD" { return "$\(cost)/yr" }
        if let currency { return "\(currency) \(cost)/yr" }
        return "\(cost)/yr"
    }
}
