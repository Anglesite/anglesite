import Foundation

/// Applies the Markdown for Agents zone setting (#1247) once a custom domain is confirmed
/// attached during deploy. Runs from `DeployCommand` right after `CustomDomainAttachCommand`
/// resolves to `.confirmed` — best-effort, like that command: a Cloudflare API failure here must
/// never turn an already-successful deploy into a failed one.
public actor MarkdownForAgentsCommand {
    /// Outcome of one apply attempt. Every case is deliberately non-fatal — same rationale as
    /// `CustomDomainAttachCommand.Result`.
    public enum Result: Sendable, Equatable {
        /// The zone is already confirmed off for this hostname — either the owner opted out and
        /// it was never turned on in the first place, or opting out just turned an already-on
        /// zone back off.
        case optedOut
        /// The zone setting is confirmed on for this hostname — either freshly written this
        /// deploy, or already matching from a prior one (no network call in the latter case).
        case applied(hostname: String)
        /// The hostname's zone isn't visible to this token yet — retried automatically on the
        /// next deploy, same as `CustomDomainAttachCommand.Result.notConnected`.
        case zoneNotFound(hostname: String)
        /// The Cloudflare API call failed (network, auth, or a plan that doesn't carry this
        /// feature) — logged, not fatal.
        case failed(hostname: String)
    }

    /// `.site-config` key recording the last hostname:state this command successfully wrote to
    /// Cloudflare, e.g. `example.com:on` — mirrors `CustomDomainAttachCommand`'s
    /// `CF_DOMAIN_ATTACHED` idempotency marker (#1321 review): without it, a confirmed-attached
    /// site would re-PATCH this zone setting on every single future deploy forever, even once it
    /// already matches the owner's desired state.
    private static let markerKey = "CF_MARKDOWN_FOR_AGENTS"

    private let client: any CloudflareWriting

    /// Creates the command. The default client talks to the live Cloudflare API; tests inject a
    /// fake ``CloudflareWriting``.
    public init(client: any CloudflareWriting = HTTPCloudflareClient()) {
        self.client = client
    }

    /// `hostname` is the confirmed-attached custom domain (`CustomDomainAttachCommand.Result
    /// .confirmed`'s payload) — sites with no custom domain have no zone to configure and never
    /// reach this call. `siteDirectory` is where `.site-config` lives (the idempotency marker,
    /// git-tracked alongside `CF_DOMAIN_ATTACHED`). `configDirectory` reads the owner's opt-out
    /// from `Config/settings.plist`; `nil` (missing config, or the field unset) means enabled,
    /// matching the feature's default-on ask. `source` tags the `LogCenter` line written on a
    /// Cloudflare API failure.
    public func apply(
        hostname: String, siteDirectory: URL, configDirectory: URL?, apiToken: String,
        source: String = "markdown-for-agents"
    ) async -> Result {
        let disabled: Bool
        if let configDirectory {
            disabled = (try? await SiteConfigStore(configDirectory: configDirectory).load())?.markdownForAgentsDisabled ?? false
        } else {
            disabled = false
        }
        let enabled = !disabled

        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let desiredMarker = "\(hostname):\(enabled ? "on" : "off")"
        let existingMarker = SiteConfigFile.value(forKey: Self.markerKey, in: config)

        if existingMarker == desiredMarker {
            return enabled ? .applied(hostname: hostname) : .optedOut
        }
        if existingMarker == nil, !enabled {
            // Never touched this zone — Cloudflare defaults the setting off, so there's nothing
            // to undo. Avoids a pointless disable call on a site that opted out from the start.
            return .optedOut
        }

        do {
            let zoneFound = try await client.setMarkdownForAgents(hostname: hostname, enabled: enabled, apiToken: apiToken)
            guard zoneFound else { return .zoneNotFound(hostname: hostname) }
            persist(marker: desiredMarker, siteDirectory: siteDirectory)
            return enabled ? .applied(hostname: hostname) : .optedOut
        } catch {
            await LogCenter.shared.append(
                source: source, stream: .stderr,
                text: "couldn't set Markdown for Agents (\(enabled ? "on" : "off")) for \(hostname): \(error)")
            return .failed(hostname: hostname)
        }
    }

    private func persist(marker: String, siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: Self.markerKey, in: config) != marker else { return }
        let updated = SiteConfigFile.upsert([(Self.markerKey, marker)], into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }
}
