import Foundation

/// Attaches a "Transfer an existing domain" site's configured domain as a Workers Custom Domain
/// once its zone is live on the connected Cloudflare account (#1077). Runs from `DeployCommand`
/// right after a successful `wrangler deploy` — best-effort, never turns a successful deploy into
/// a failed one.
public actor CustomDomainAttachCommand {
    public enum Result: Sendable, Equatable {
        /// No transfer domain configured, or it's already confirmed attached — nothing to do.
        case skipped
        /// Freshly attached, or already attached to this site's own Worker script.
        case confirmed(hostname: String)
        /// The domain isn't on this Cloudflare account yet (nameservers not delegated elsewhere).
        /// Retried automatically on the next deploy — nothing is persisted for this outcome.
        case notConnected(hostname: String)
        /// Already attached to a *different* Worker script. Never silently repointed.
        case conflict(hostname: String, ownedBy: String)
    }

    private let client: any CloudflareWriting

    public init(client: any CloudflareWriting = HTTPCloudflareClient()) {
        self.client = client
    }

    /// Reads `.site-config` itself (`DOMAIN_CHOICE`, `DOMAIN`, `CF_PROJECT_NAME`,
    /// `CF_DOMAIN_ATTACHED`) — callers only need to supply the site directory and a live token.
    public func attach(siteDirectory: URL, apiToken: String) async -> Result {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""

        guard SiteConfigFile.value(forKey: "DOMAIN_CHOICE", in: config) == NewSiteDomainChoice.transfer.rawValue,
              let hostname = SiteConfigFile.value(forKey: "DOMAIN", in: config)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              !hostname.isEmpty
        else { return .skipped }

        guard SiteConfigFile.value(forKey: "CF_DOMAIN_ATTACHED", in: config) != "true" else { return .skipped }

        guard let workerScriptName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) else {
            return .skipped
        }

        let outcome: CustomDomainAttachResult
        do {
            outcome = try await client.attachWorkersCustomDomain(
                hostname: hostname, workerScriptName: workerScriptName, apiToken: apiToken)
        } catch {
            // Best-effort: a Cloudflare API failure here must never turn an already-successful
            // deploy into a failed one. Folded into the same "nothing to report loudly, retried
            // for free on the next deploy" bucket as a genuine not-yet-delegated zone.
            return .notConnected(hostname: hostname)
        }

        switch outcome {
        case .attached, .alreadyAttached:
            persistAttached(siteDirectory: siteDirectory)
            return .confirmed(hostname: hostname)
        case .zoneNotFound:
            return .notConnected(hostname: hostname)
        case .conflict(let ownedBy):
            return .conflict(hostname: hostname, ownedBy: ownedBy)
        }
    }

    private func persistAttached(siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_DOMAIN_ATTACHED", in: config) != "true" else { return }
        let updated = SiteConfigFile.upsert([("CF_DOMAIN_ATTACHED", "true")], into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }
}
