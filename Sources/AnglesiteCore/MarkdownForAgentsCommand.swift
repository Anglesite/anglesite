import Foundation

/// Applies the Markdown for Agents zone setting (#1247) once a custom domain is confirmed
/// attached during deploy. Runs from `DeployCommand` right after `CustomDomainAttachCommand`
/// resolves to `.confirmed` — best-effort, like that command: a Cloudflare API failure here must
/// never turn an already-successful deploy into a failed one.
public actor MarkdownForAgentsCommand {
    /// Outcome of one apply attempt. Every case is deliberately non-fatal — same rationale as
    /// `CustomDomainAttachCommand.Result`.
    public enum Result: Sendable, Equatable {
        /// The owner opted out (`SiteSettings.markdownForAgentsDisabled == true`) — no network
        /// call made.
        case optedOut
        /// The zone setting was written successfully.
        case applied(hostname: String)
        /// The hostname's zone isn't visible to this token yet — retried automatically on the
        /// next deploy, same as `CustomDomainAttachCommand.Result.notConnected`.
        case zoneNotFound(hostname: String)
        /// The Cloudflare API call failed (network, auth, or a plan that doesn't carry this
        /// feature) — logged, not fatal.
        case failed(hostname: String)
    }

    private let client: any CloudflareWriting

    /// Creates the command. The default client talks to the live Cloudflare API; tests inject a
    /// fake ``CloudflareWriting``.
    public init(client: any CloudflareWriting = HTTPCloudflareClient()) {
        self.client = client
    }

    /// `hostname` is the confirmed-attached custom domain (`CustomDomainAttachCommand.Result
    /// .confirmed`'s payload) — sites with no custom domain have no zone to configure and never
    /// reach this call. `configDirectory` reads the owner's opt-out from `Config/settings.plist`;
    /// `nil` (missing config, or the field unset) means enabled, matching the feature's
    /// default-on ask. `source` tags the `LogCenter` line written on a Cloudflare API failure.
    public func apply(
        hostname: String, configDirectory: URL?, apiToken: String, source: String = "markdown-for-agents"
    ) async -> Result {
        let disabled: Bool
        if let configDirectory {
            disabled = (try? await SiteConfigStore(configDirectory: configDirectory).load())?.markdownForAgentsDisabled ?? false
        } else {
            disabled = false
        }
        guard !disabled else { return .optedOut }

        do {
            let zoneFound = try await client.setMarkdownForAgents(hostname: hostname, enabled: true, apiToken: apiToken)
            return zoneFound ? .applied(hostname: hostname) : .zoneNotFound(hostname: hostname)
        } catch {
            await LogCenter.shared.append(
                source: source, stream: .stderr,
                text: "couldn't enable Markdown for Agents for \(hostname): \(error)")
            return .failed(hostname: hostname)
        }
    }
}
