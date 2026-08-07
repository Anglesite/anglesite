import Foundation

/// Write-side Cloudflare API seam. The concrete `HTTPCloudflareClient` talks to the
/// v4 REST API; tests provide a mock. Token is passed per call (no Keychain coupling).
public protocol CloudflareWriting: Sendable {
    /// Turn on DNSSEC signing for the zone. Enable-only by design — the hardening flow never
    /// needs to switch DNSSEC off, so the seam offers no disable.
    func enableDNSSEC(zoneID: String, apiToken: String) async throws
    /// Set the zone-level "Always Use HTTPS" edge redirect (HTTP → HTTPS before origin).
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Write the zone's HSTS edge header (`security_header` setting). Parameters mirror
    /// ``CloudflareZoneState/HSTS``, the read-side shape the audit grades.
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool,
                 apiToken: String) async throws
    /// Create a DNS record. Not idempotent — Cloudflare stores duplicates without complaint, so
    /// callers (e.g. `HardenExecutor`) only add records the zone state showed missing.
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws
    /// Delete a DNS record by its Cloudflare-assigned record id (from `listDNSRecords`).
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws
    /// Toggle Bot Fight Mode, the free-plan bot mitigation the audit recommends.
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Append a custom WAF rule to the zone's `http_request_firewall_custom` phase ruleset.
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws
    /// Toggle Speed Brain (speculation-rules prefetching at the edge).
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Toggle Encrypted Client Hello (hides the SNI hostname from on-path observers).
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Idempotent: creates the `http_response_compression` ruleset with a zstd-first rule, or
    /// appends the rule to the existing ruleset.
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws
    /// Toggle Page Shield's client-side script monitoring for the zone.
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Enable/Disable Cloudflare's Onion Routing feature.
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws
    /// Attaches `hostname` to `workerScriptName` as a Workers Custom Domain (#1077). Idempotent:
    /// an existing attachment to the same script is a no-op; an existing attachment to a
    /// *different* script is reported as `.conflict` rather than silently overwritten.
    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult
    /// Toggles Markdown for Agents (`content_converter`) for the zone owning `hostname` — the
    /// edge feature that serves an HTML→Markdown-converted response to requests carrying
    /// `Accept: text/markdown` (#1247). Resolves the zone from `hostname` itself, mirroring
    /// `attachWorkersCustomDomain`, since callers (post-deploy, after a custom domain is
    /// confirmed attached) only have the hostname on hand. Returns `false` when the zone isn't
    /// visible to this token yet — a transient condition callers should treat as best-effort
    /// skip, not an error.
    @discardableResult
    func setMarkdownForAgents(hostname: String, enabled: Bool, apiToken: String) async throws -> Bool
}

/// Payload for creating a DNS record via the Cloudflare API.
public struct DNSRecordPayload: Sendable, Equatable, Encodable {
    /// DNS record type (`A`, `CNAME`, `MX`, `TXT`, `CAA`, …) as the API expects it.
    public let type: String
    /// Record name; Cloudflare accepts `@` for the zone apex as well as fully-qualified names.
    public let name: String
    /// Record content (target host, IP, quoted TXT payload, …), passed through verbatim.
    public let content: String
    /// TTL in seconds; the default `1` is Cloudflare's sentinel for "automatic".
    public let ttl: Int
    /// Only meaningful for record types with a priority field (MX/SRV/URI). `nil` — the default —
    /// is omitted from the encoded JSON entirely (synthesized `Encodable` uses `encodeIfPresent`),
    /// so priority-less record types never see a spurious field.
    public let priority: Int?
    /// Cloudflare's free-text `comment` field, stamped by ``DomainOperations/addRecord(domain:type:name:content:ttl:priority:purpose:sourceDirectory:)``
    /// as `"anglesite:<purpose>"` when the caller supplies a purpose (#1170) — lets reconciliation
    /// join a declared `anglesite.json` record to its live Cloudflare counterpart (investigation
    /// doc §5.3). `nil` — the default — omits the key entirely (synthesized `Encodable` uses
    /// `encodeIfPresent`), matching every other optional field here.
    public let comment: String?

    /// Defaults produce the common case: an automatic-TTL record with no priority field.
    public init(type: String, name: String, content: String, ttl: Int = 1, priority: Int? = nil, comment: String? = nil) {
        self.type = type
        self.name = name
        self.content = content
        self.ttl = ttl
        self.priority = priority
        self.comment = comment
    }
}

/// Payload for creating a custom WAF rule via the Cloudflare API.
public struct WAFRulePayload: Sendable, Equatable, Encodable {
    /// Human-readable rule description shown in the Cloudflare dashboard. Doubles as the identity
    /// the hardening planner dedupes on (case-insensitively, against
    /// ``CloudflareZoneState/wafCustomRules``) — so keep it stable for a given rule template.
    public let description: String
    /// The rule's match expression in Cloudflare's Rules language (e.g. `(cf.client.bot)`).
    public let expression: String
    /// What the rule does on match — a Cloudflare action name such as `block` or
    /// `managed_challenge`, passed through verbatim.
    public let action: String

    /// Memberwise initializer; the hardening planner builds these from its canned rule templates.
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
