import Foundation

/// Writes a site's domain intent into `Source/anglesite.json`'s `domain` section (#1169/#1170) —
/// the single place `CustomDomainAttachCommand` (post-deploy, transfer-only) and
/// `ConnectDomainCommand` (the Connect a Domain sheet, #1180) both go through, so the two call
/// sites can't drift on what a "transfer" or "buy" declaration looks like on disk.
public enum DomainIntentRecorder {
    /// Declares an owned-domain (`transfer`) intent: `attach: true` records that the owner wants
    /// this hostname attached as a Workers Custom Domain once its zone is live on the connected
    /// Cloudflare account — the confirmed-live receipt itself is `.site-config`'s
    /// `CF_DOMAIN_ATTACHED`, written separately (`CustomDomainAttachCommand.persistAttached`) once
    /// attach actually succeeds. Best-effort — a write failure here must never surface as an
    /// error to the caller (matches `CustomDomainAttachCommand`'s existing posture).
    public static func recordTransferIntent(hostname: String, siteDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: siteDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        config.domain = DomainConfig.Domain(
            hostname: hostname, choice: NewSiteDomainChoice.transfer.rawValue, attach: true)
        try? store.save(config)
    }

    /// Declares a buy-a-domain intent: no hostname exists yet, so `attach` is `false` — there is
    /// nothing to attach until the owner comes back with a real hostname (via the transfer path
    /// above, once they've bought one). Best-effort, matching `recordTransferIntent`.
    public static func recordBuyIntent(siteDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: siteDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        config.domain = DomainConfig.Domain(
            hostname: nil, choice: NewSiteDomainChoice.buy.rawValue, attach: false)
        try? store.save(config)
    }
}
