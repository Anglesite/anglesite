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

    /// Set by `chooseBuy()` right before it dismisses this sheet; consumed by `SiteWindow`'s
    /// `onDismiss` on the `connectDomain` sheet registration to open `BuyDomainSheetView` only
    /// *after* this sheet's own dismissal transaction finishes. Two sibling `.sheet` modifiers
    /// dismissing-and-presenting synchronously in the same SwiftUI transaction is a known-risky
    /// pattern (see the presentation-binding race behind #968/#969) — `onDismiss` is the
    /// idiomatic way to sequence "close this sheet, then open that one" instead.
    var pendingBuyDomain: Bool = false

    private let rdap: any RDAPLookupService
    private var registrarLookupTask: Task<Void, Never>?
    private var currentSite: CurrentSite?
    /// Bumped every time `loadRegistrarInfo` starts a new lookup, and captured locally before the
    /// `Task` spawns. `registrarLookupTask?.cancel()` alone can't stop a stale lookup from
    /// eventually resuming — `RDAPLookupService.lookup(hostname:)` is non-throwing and doesn't
    /// participate in cooperative cancellation — so a superseded task's continuation would
    /// otherwise still be able to overwrite `registrarInfo`/`anglesite.json` or clobber
    /// `isLookingUpRegistrarInfo` after a newer lookup already finished. Comparing the captured
    /// generation against this property before every mutation makes a stale task's completion a
    /// complete no-op once superseded (reopening the sheet before the first lookup resolves, or a
    /// double-tap on submit, both spawn two lookups for the same hostname).
    private var registrarLookupGeneration = 0

    /// The Cloudflare Domains marketing page — surfaced as the escape-hatch link inside
    /// `BuyDomainSheetView` (via `BuyDomainModel.cloudflareDomainsURL`, which aliases this) for
    /// owners who prefer registering directly on Cloudflare.
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
        pendingBuyDomain = false
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
        registrarLookupTask = nil
        isLookingUpRegistrarInfo = false
        sheetPresented = false
    }

    /// "Not now" — dismisses without writing anything. `DOMAIN_CHOICE` stays whatever it already
    /// was (`later` by default), so this is a true no-op.
    func notNow() {
        dismissSheet()
    }

    /// "Buy a domain" — records the buy intent, flags the handoff for `SiteWindow`'s
    /// `onDismiss`, then dismisses. See `pendingBuyDomain`'s doc comment for why the actual
    /// `BuyDomainSheetView` presentation happens on dismiss rather than synchronously here.
    func chooseBuy() {
        guard let site = currentSite else { return }
        ConnectDomainCommand.recordBuy(siteDirectory: site.sourceDirectory)
        pendingBuyDomain = true
        dismissSheet()
    }

    /// "I already own a domain" — reveals the hostname field.
    func beginTransfer() {
        phase = .enteringHostname
    }

    /// "Use a different domain" — from `.connected`, lets the owner correct a previously-declared
    /// hostname (a typo, or switching domains entirely) instead of being stuck with only "Done"
    /// (#1194 review round 3: the sheet had become a dead end once a transfer was declared). Seeds
    /// `hostnameInput` with the currently-connected hostname so `submitTransfer()` reaches it
    /// exactly the same way `beginTransfer()` does — it doesn't care how `.enteringHostname` was
    /// reached.
    func beginChangeDomain() {
        guard case .connected(let hostname) = phase else { return }
        hostnameInput = hostname
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
        if let cached = declared?.domain, cached.hostname == hostname {
            let registrar = Self.nonBlank(cached.registrar)
            let expiresAt = Self.nonBlank(cached.expiresAt)
            if registrar != nil || expiresAt != nil {
                registrarInfo = .available(RDAPDomainInfo(registrar: registrar, expiresAt: expiresAt))
            } else {
                registrarInfo = .loading
            }
        } else {
            registrarInfo = .loading
        }

        isLookingUpRegistrarInfo = true
        registrarLookupTask?.cancel()
        registrarLookupGeneration += 1
        let generation = registrarLookupGeneration
        registrarLookupTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let result = await self.rdap.lookup(hostname: hostname)
            // A newer lookup superseded this one (reopen-before-resolve, or a double submit) —
            // this task's completion is a no-op, including the `isLookingUpRegistrarInfo` write,
            // so it can't clear a flag the newer task already set.
            guard generation == self.registrarLookupGeneration else { return }
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

    /// Normalizes `DomainIntentRecorder`'s explicit-`""` "clear the stale value" marker (#1194
    /// review round 3) back to `nil` — a freshly-cleared registrar/expiration reads the same as
    /// "no cached value yet" (`.loading`), not as a blank display line.
    private static func nonBlank(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private func persistRegistrarInfo(_ info: RDAPDomainInfo, hostname: String, sourceDirectory: URL) {
        DomainConfigStore.update(sourceDirectory: sourceDirectory) { config in
            guard config.domain?.hostname == hostname else { return }
            config.domain?.registrar = info.registrar
            config.domain?.expiresAt = info.expiresAt
        }
    }
}
