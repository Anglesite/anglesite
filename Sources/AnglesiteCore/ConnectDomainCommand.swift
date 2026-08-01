import Foundation

/// Records the owner's buy/transfer choice from the "Connect a Domain" sheet (#1180) into both
/// `.site-config` (`DOMAIN_CHOICE`/`DOMAIN` — what `CustomDomainAttachCommand`/`DeployCommand`
/// already consume) and `Source/anglesite.json`'s `domain` section (via `DomainIntentRecorder`,
/// shared with `CustomDomainAttachCommand`'s own post-deploy write). No network calls — the
/// actual Workers Custom Domain attach stays entirely owned by `CustomDomainAttachCommand`, which
/// already runs on every deploy and will pick up a freshly-written `DOMAIN_CHOICE=transfer` on
/// the owner's next Publish.
public enum ConnectDomainCommand {
    /// "Buy a domain" — no hostname exists yet. Writes `DOMAIN_CHOICE=buy` as an intent marker;
    /// nothing currently reads it back except as bookkeeping (the sheet itself opens the
    /// Cloudflare Domains link separately, in the view layer).
    public static func recordBuy(siteDirectory: URL) {
        writeSiteConfigChoice(.buy, hostname: nil, siteDirectory: siteDirectory)
        DomainIntentRecorder.recordBuyIntent(siteDirectory: siteDirectory)
    }

    /// "I already own a domain" — `hostname` is the owner's typed-in domain (trimmed, non-empty;
    /// callers validate before calling this). Writes `DOMAIN_CHOICE=transfer` + `DOMAIN=hostname`
    /// so the existing `CustomDomainAttachCommand` step in the deploy pipeline attaches it on the
    /// owner's next Publish — this command performs no attach itself.
    public static func recordTransfer(hostname: String, siteDirectory: URL) {
        writeSiteConfigChoice(.transfer, hostname: hostname, siteDirectory: siteDirectory)
        DomainIntentRecorder.recordTransferIntent(hostname: hostname, siteDirectory: siteDirectory)
    }

    private static func writeSiteConfigChoice(
        _ choice: NewSiteDomainChoice, hostname: String?, siteDirectory: URL
    ) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        var updated = SiteConfigFile.upsert([("DOMAIN_CHOICE", choice.rawValue)], into: config)
        if let hostname {
            updated = SiteConfigFile.upsert([("DOMAIN", hostname)], into: updated)
        } else {
            // The sheet is re-enterable: an owner who previously picked "I already own a domain"
            // (writing `DOMAIN=<hostname>`) can come back and pick "Buy a domain" instead. Remove
            // any stale `DOMAIN` line rather than leaving it sitting next to the fresh
            // `DOMAIN_CHOICE=buy` — and never write it as an empty value, since a present-but-empty
            // `DOMAIN=` line still makes `WebsiteAnalyticsAsset.configValue` return `""` (non-nil),
            // short-circuiting `bestHost`'s fallback chain.
            updated = SiteConfigFile.remove(["DOMAIN"], from: updated)
        }
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }
}
