import SwiftUI
import AnglesiteCore

/// Drives the "Connect a Domain" sheet (#1180): buy/transfer/later, reachable from the
/// first-publish nudge in `DeployDrawerView` and permanently from `Website ▸ Connect a Domain…`.
/// Every domain-declaration action is a synchronous local file write via `ConnectDomainCommand` —
/// no network calls, unlike `HardenModel`/`DomainModel`. The actual Workers Custom Domain attach
/// stays owned by `CustomDomainAttachCommand`, which already runs on every deploy. The one
/// exception is registrar/expiration lookup (#1194): a passive, best-effort RDAP query that never
/// blocks or gates anything else in this sheet.
@MainActor
@Observable
final class ConnectDomainModel {
    enum Phase: Equatable {
        case choosing
        case enteringHostname
        case connected(hostname: String)
    }

    /// Registrar/expiration info for the connected hostname (#1194) — orthogonal to `phase` since
    /// it loads and refreshes on its own schedule instead of gating the sheet's own flow.
    enum RegistrarInfoState: Equatable {
        case idle
        case loading
        case available(RDAPDomainInfo)
        case unavailable
    }

    private(set) var phase: Phase = .choosing
    var sheetPresented: Bool = false
    var hostnameInput: String = ""
    private(set) var registrarInfo: RegistrarInfoState = .idle
    /// `true` while an RDAP lookup is in flight — lets tests deterministically wait for the
    /// background `Task` `loadRegistrarInfo` spawns to finish, the same role `DomainModel.isRunning`
    /// plays for its own async work.
    private(set) var isLookingUpRegistrarInfo: Bool = false

    private let rdap: any RDAPLookupService
    private var registrarLookupTask: Task<Void, Never>?
    private var currentSite: CurrentSite?

    /// The Cloudflare Domains marketing page — opened by the view layer's "Buy a domain" button,
    /// not by `chooseBuy()` itself, so this model stays free of `NSWorkspace`/AppKit side effects
    /// and is fully testable (matches `WebsiteCommands`'s "View on GitHub" convention of keeping
    /// `NSWorkspace.shared.open` out of the model layer).
    static let cloudflareDomainsURL = URL(string: "https://www.cloudflare.com/products/registrar/")!

    /// `rdap` is injectable for tests; production callers take the default `RDAPClient`.
    init(rdap: any RDAPLookupService = RDAPClient()) {
        self.rdap = rdap
    }

    /// Threaded from `SiteWindowModel.loadAndStart`, mirroring `DomainModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }

    /// Resets to `.choosing` unless `anglesite.json` already declares an owned (`transfer`)
    /// hostname, in which case this jumps straight to `.connected` and kicks off a registrar
    /// lookup — the only way to revisit a previously-connected domain's registrar/expiration info
    /// (#1194). A `buy` declaration (no real hostname yet) or no declaration at all still starts
    /// at `.choosing`, unchanged from #1180.
    func openSheet() {
        hostnameInput = ""
        registrarLookupTask?.cancel()
        registrarLookupTask = nil
        isLookingUpRegistrarInfo = false
        registrarInfo = .idle

        if let site = currentSite,
           let declared = try? DomainConfigStore(sourceDirectory: site.sourceDirectory).load(),
           let hostname = declared.domain?.hostname, !hostname.isEmpty,
           declared.domain?.choice == NewSiteDomainChoice.transfer.rawValue {
            phase = .connected(hostname: hostname)
            loadRegistrarInfo(hostname: hostname, sourceDirectory: site.sourceDirectory)
        } else {
            phase = .choosing
        }
        sheetPresented = true
    }

    func dismissSheet() {
        registrarLookupTask?.cancel()
        sheetPresented = false
    }

    /// "Not now" — dismisses without writing anything. `DOMAIN_CHOICE` stays whatever it already
    /// was (`later` by default), so this is a true no-op.
    func notNow() {
        dismissSheet()
    }

    /// "Buy a domain" — records the buy intent and dismisses. Opening Cloudflare Domains in the
    /// browser is the view's job (see `cloudflareDomainsURL`'s doc comment).
    func chooseBuy() {
        guard let site = currentSite else { return }
        ConnectDomainCommand.recordBuy(siteDirectory: site.sourceDirectory)
        dismissSheet()
    }

    /// "I already own a domain" — reveals the hostname field.
    func beginTransfer() {
        phase = .enteringHostname
    }

    /// Submits the typed hostname. No format validation beyond non-empty/trim, matching
    /// `DomainModel.resolveAndLoad` — a malformed hostname simply won't resolve a Cloudflare zone
    /// on the next deploy, surfaced there exactly like today's `.notConnected` outcome.
    func submitTransfer() {
        guard case .enteringHostname = phase, let site = currentSite else { return }
        let hostname = hostnameInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !hostname.isEmpty else { return }
        ConnectDomainCommand.recordTransfer(hostname: hostname, siteDirectory: site.sourceDirectory)
        phase = .connected(hostname: hostname)
        loadRegistrarInfo(hostname: hostname, sourceDirectory: site.sourceDirectory)
    }

    // MARK: - Private

    /// Seeds `registrarInfo` from whatever's already cached in `anglesite.json` (instant, no
    /// spinner) and kicks off a fresh RDAP lookup in the background. A successful lookup updates
    /// `registrarInfo` and persists into `anglesite.json`; a failed one only clears a `.loading`
    /// placeholder to `.unavailable` — it never regresses an already-good cached value back to
    /// nothing.
    private func loadRegistrarInfo(hostname: String, sourceDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        let declared = try? store.load()
        if let cached = declared?.domain, cached.hostname == hostname,
           cached.registrar != nil || cached.expiresAt != nil {
            registrarInfo = .available(RDAPDomainInfo(registrar: cached.registrar, expiresAt: cached.expiresAt))
        } else {
            registrarInfo = .loading
        }

        isLookingUpRegistrarInfo = true
        registrarLookupTask?.cancel()
        registrarLookupTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let result = await self.rdap.lookup(hostname: hostname)
            self.isLookingUpRegistrarInfo = false
            guard case .connected(let current) = self.phase, current == hostname else { return }
            if let result, result.registrar != nil || result.expiresAt != nil {
                self.registrarInfo = .available(result)
                self.persistRegistrarInfo(result, hostname: hostname, sourceDirectory: sourceDirectory)
            } else if case .loading = self.registrarInfo {
                self.registrarInfo = .unavailable
            }
        }
    }

    private func persistRegistrarInfo(_ info: RDAPDomainInfo, hostname: String, sourceDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        guard var config = try? store.load(), config.domain?.hostname == hostname else { return }
        config.domain?.registrar = info.registrar
        config.domain?.expiresAt = info.expiresAt
        try? store.save(config)
    }
}
