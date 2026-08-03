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
    /// The Cloudflare dashboard root — used specifically by `.needsAccountSetup`'s "finish setting
    /// up billing" link, which needs to land the user in the dashboard rather than on the
    /// `cloudflareDomainsURL` marketing page. No deeper deep-link path is guessed here since one
    /// hasn't been verified against the live product.
    static let cloudflareDashboardURL = URL(string: "https://dash.cloudflare.com/")!

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

    /// Always presents the sheet — never a silent no-op, even while a purchase is still running
    /// in the background after an earlier dismiss (see `dismissSheet()`). Only resets to a fresh
    /// `.searching` state when nothing is running, so reopening during a backgrounded purchase
    /// shows the live `.purchasing` state instead of discarding it.
    func openSheet() {
        sheetPresented = true
        guard !isRunning else { return }
        phase = .searching(query: "")
        queryInput = ""
    }

    /// Closes the sheet. A `.purchasing` task is deliberately **not** cancelled: the
    /// `POST /registrar/registrations` it's awaiting may already be in flight at Cloudflare, and
    /// cancelling the local `Task` doesn't un-send it or refund a charge — it would only make the
    /// app stop tracking a purchase that still completes (or fails) server-side. So a purchase
    /// keeps running in the background after Close; `runPurchase` still writes `recordTransfer`
    /// on a genuine `.succeeded` outcome, and reopening the sheet (`openSheet()`) shows the
    /// in-progress state rather than losing it. Search's `.loadingResults` has no such stakes (a
    /// GET has no side effects to protect) and keeps today's cancel-on-close behavior.
    func dismissSheet() {
        if case .purchasing = phase {
            // Deliberately not cancelled — see doc comment above.
        } else {
            inFlight?.cancel()
            inFlight = nil
        }
        sheetPresented = false
        pendingSearchQuery = nil
        tokenPromptPresented = false
    }

    func submitSearch() {
        let query = queryInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, !isRunning else { return }
        // Set synchronously (not as the first line inside the spawned Task) so `isRunning`
        // flips before this call returns — closing the window where a second activation in the
        // same run-loop turn could pass the `!isRunning` guard above. See `confirmPurchase()`.
        phase = .loadingResults(query: query)
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runSearch(query: query)
        }
    }

    func selectCandidate(_ candidate: DomainCandidate) {
        // `priceDisplay` can be nil for a `registrable: true` result (`CFRegistrarCheckResult
        // .pricing` decodes as optional) — require both so the confirm step never reads "Buy
        // example.dev for an unknown price?" with an enabled Buy button on a real charge.
        guard candidate.registrable, candidate.priceDisplay != nil, case .results = phase else { return }
        phase = .confirming(candidate: candidate)
    }

    func cancelConfirm() {
        guard case .confirming = phase else { return }
        phase = .searching(query: queryInput)
    }

    func confirmPurchase() {
        guard case .confirming(let candidate) = phase, !isRunning else { return }
        // Set synchronously, not inside the spawned Task — `Task { @MainActor ... }` is
        // scheduled, not run inline, so a `phase` write on its first line leaves a window (until
        // the task's first hop) where `phase` is still `.confirming` and `isRunning` is still
        // `false`. A second activation in that window (e.g. a held/double-tapped Return, since
        // the Buy button carries `.keyboardShortcut(.defaultAction)`) would pass the guard above
        // and could fire a second `POST /registrar/registrations` for a real charge.
        phase = .purchasing(candidate: candidate)
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
        // `phase` is already `.loadingResults(query:)` — set synchronously by `submitSearch()`.
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
                let unsorted = checks.map {
                    DomainCandidate(
                        name: $0.name, registrable: $0.registrable, reason: $0.reason,
                        priceDisplay: Self.priceDisplay(cost: $0.registrationCost, currency: $0.currency))
                }
                // Available-first per the spec, with the row order within each group otherwise
                // matching the API's response — `sorted(by:)` alone isn't a guaranteed-stable
                // sort, so tiebreak explicitly on original index rather than relying on that.
                let candidates = unsorted.enumerated()
                    .sorted { a, b in
                        if a.element.registrable != b.element.registrable {
                            return a.element.registrable && !b.element.registrable
                        }
                        return a.offset < b.offset
                    }
                    .map(\.element)
                phase = .results(query: query, candidates: candidates)
            }
        }
    }

    private func runPurchase(candidate: DomainCandidate) async {
        // `phase` is already `.purchasing(candidate:)` — set synchronously by `confirmPurchase()`.
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
