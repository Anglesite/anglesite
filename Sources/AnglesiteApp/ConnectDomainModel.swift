import SwiftUI
import AnglesiteCore

/// Drives the "Connect a Domain" sheet (#1180): buy/transfer/later, reachable from the
/// first-publish nudge in `DeployDrawerView` and permanently from `Website ▸ Connect a Domain…`.
/// Every action is a synchronous local file write via `ConnectDomainCommand` — no network calls,
/// unlike `HardenModel`/`DomainModel`. The actual Workers Custom Domain attach stays owned by
/// `CustomDomainAttachCommand`, which already runs on every deploy.
@MainActor
@Observable
final class ConnectDomainModel {
    enum Phase: Equatable {
        case choosing
        case enteringHostname
        case connected(hostname: String)
    }

    private(set) var phase: Phase = .choosing
    var sheetPresented: Bool = false
    var hostnameInput: String = ""

    private var currentSite: CurrentSite?

    /// The Cloudflare Domains marketing page — opened by the view layer's "Buy a domain" button,
    /// not by `chooseBuy()` itself, so this model stays free of `NSWorkspace`/AppKit side effects
    /// and is fully testable (matches `WebsiteCommands`'s "View on GitHub" convention of keeping
    /// `NSWorkspace.shared.open` out of the model layer).
    static let cloudflareDomainsURL = URL(string: "https://www.cloudflare.com/products/registrar/")!

    /// Threaded from `SiteWindowModel.loadAndStart`, mirroring `DomainModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }

    func openSheet() {
        phase = .choosing
        hostnameInput = ""
        sheetPresented = true
    }

    func dismissSheet() {
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
    }
}
