import Foundation

/// Attaches a "Transfer an existing domain" site's configured domain as a Workers Custom Domain
/// once its zone is live on the connected Cloudflare account (#1077). Runs from `DeployCommand`
/// right after a successful `wrangler deploy` — best-effort, never turns a successful deploy into
/// a failed one.
public actor CustomDomainAttachCommand {
    /// Outcome of one post-deploy attach attempt. Every case is deliberately non-fatal — the
    /// deploy already succeeded, so callers report these, never fail on them.
    public enum Result: Sendable, Equatable {
        /// No transfer domain configured — nothing to do.
        case skipped
        /// Freshly attached, already attached to this site's own Worker script, or already
        /// confirmed attached on a prior deploy and unchanged since (no network call).
        case confirmed(hostname: String)
        /// The domain isn't on this Cloudflare account yet (nameservers not delegated elsewhere).
        /// Retried automatically on the next deploy — nothing is persisted for this outcome.
        case notConnected(hostname: String)
        /// Already attached to a *different* Worker script. Never silently repointed.
        case conflict(hostname: String, ownedBy: String)
    }

    private let client: any CloudflareWriting

    /// Creates the command. The default client talks to the live Cloudflare API; tests inject a
    /// fake ``CloudflareWriting``.
    public init(client: any CloudflareWriting = HTTPCloudflareClient()) {
        self.client = client
    }

    /// Reads `.site-config` itself (`DOMAIN_CHOICE`, `DOMAIN`, `CF_PROJECT_NAME`,
    /// `CF_DOMAIN_ATTACHED`) — callers only need to supply the site directory and a live token.
    /// `source` tags the `LogCenter` line written on a Cloudflare API failure; defaults to a
    /// generic tag for callers (mostly tests) that don't care where it surfaces.
    public func attach(
        siteDirectory: URL, apiToken: String, source: String = "custom-domain-attach"
    ) async -> Result {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""

        guard SiteConfigFile.value(forKey: "DOMAIN_CHOICE", in: config) == NewSiteDomainChoice.transfer.rawValue,
              let hostname = SiteConfigFile.value(forKey: "DOMAIN", in: config)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              !hostname.isEmpty
        else { return .skipped }

        DomainIntentRecorder.recordTransferIntent(hostname: hostname, siteDirectory: siteDirectory)

        // Already confirmed attached to this exact hostname on a prior deploy — no network call
        // needed (this is what keeps every deploy after the first cheap). If the owner changed
        // `DOMAIN` to a different host since the last confirmed attach, this won't match, and
        // falls through to a real check/attach against the new hostname below.
        if SiteConfigFile.value(forKey: "CF_DOMAIN_ATTACHED", in: config) == hostname {
            return .confirmed(hostname: hostname)
        }

        guard let workerScriptName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config),
              !workerScriptName.isEmpty
        else { return .skipped }

        let outcome: CustomDomainAttachResult
        do {
            outcome = try await client.attachWorkersCustomDomain(
                hostname: hostname, workerScriptName: workerScriptName, apiToken: apiToken)
        } catch {
            // Best-effort: a Cloudflare API failure here must never turn an already-successful
            // deploy into a failed one. Folded into the same "nothing to report loudly, retried
            // for free on the next deploy" bucket as a genuine not-yet-delegated zone — but the
            // error itself is worth keeping around for diagnosis (CLAUDE.md: "logs are sacred"),
            // since a stale/under-scoped token would otherwise degrade to this same outcome
            // forever with no way to tell it apart from "not delegated yet."
            await LogCenter.shared.append(
                source: source, stream: .stderr,
                text: "couldn't check whether \(hostname) is attached as a Custom Domain: \(error)")
            return .notConnected(hostname: hostname)
        }

        switch outcome {
        case .attached, .alreadyAttached:
            persistAttached(hostname: hostname, siteDirectory: siteDirectory)
            return .confirmed(hostname: hostname)
        case .zoneNotFound:
            return .notConnected(hostname: hostname)
        case .conflict(let ownedBy):
            return .conflict(hostname: hostname, ownedBy: ownedBy)
        }
    }

    private func persistAttached(hostname: String, siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_DOMAIN_ATTACHED", in: config) != hostname else { return }
        let updated = SiteConfigFile.upsert([("CF_DOMAIN_ATTACHED", hostname)], into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }
}
