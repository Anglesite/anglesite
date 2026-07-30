import Foundation

/// Write-side Cloudflare API seam. The concrete `HTTPCloudflareClient` talks to the
/// v4 REST API; tests provide a mock. Token is passed per call (no Keychain coupling).
public protocol CloudflareWriting: Sendable {
    func enableDNSSEC(zoneID: String, apiToken: String) async throws
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool,
                 apiToken: String) async throws
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws
    /// Delete a DNS record by its Cloudflare-assigned record id (from `listDNSRecords`).
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Idempotent: creates the `http_response_compression` ruleset with a zstd-first rule, or
    /// appends the rule to the existing ruleset.
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Enable/Disable Cloudflare's Onion Routing feature.
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Attaches `hostname` to `workerScriptName` as a Workers Custom Domain (#1077). Idempotent:
    /// an existing attachment to the same script is a no-op; an existing attachment to a
    /// *different* script is reported as `.conflict` rather than silently overwritten.
    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult
}

/// Payload for creating a DNS record via the Cloudflare API.
public struct DNSRecordPayload: Sendable, Equatable, Encodable {
    public let type: String
    public let name: String
    public let content: String
    public let ttl: Int
    public let priority: Int?

    public init(type: String, name: String, content: String, ttl: Int = 1, priority: Int? = nil) {
        self.type = type
        self.name = name
        self.content = content
        self.ttl = ttl
        self.priority = priority
    }
}

/// Payload for creating a custom WAF rule via the Cloudflare API.
public struct WAFRulePayload: Sendable, Equatable, Encodable {
    public let description: String
    public let expression: String
    public let action: String

    public init(description: String, expression: String, action: String) {
        self.description = description
        self.expression = expression
        self.action = action
    }
}

/// Outcome of attempting to attach a Workers Custom Domain (#1077).
public enum CustomDomainAttachResult: Sendable, Equatable {
    /// No existing attachment for this hostname — created fresh.
    case attached
    /// Already attached to the given Worker script — no write performed.
    case alreadyAttached
    /// The domain isn't on this Cloudflare account yet (nameservers not delegated elsewhere).
    case zoneNotFound
    /// Already attached to a *different* Worker script — never silently repointed.
    case conflict(ownedBy: String)
}
