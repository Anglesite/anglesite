import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Errors surfaced by the Cloudflare read client.
public enum CloudflareError: Error, Equatable, Sendable {
    /// Cloudflare answered 401/403 — the token is invalid, expired, or missing a scope. Kept
    /// distinct from ``http(status:)`` so callers can point the user at the token, not the network.
    case unauthorized
    /// Any other non-2xx status. The body wasn't consulted — Cloudflare's error envelope is only
    /// decoded for 2xx responses whose `success` flag is false (see ``api(message:)``).
    case http(status: Int)
    /// The request reached the API but Cloudflare reported failure in its response envelope
    /// (`success: false`); `message` is the first error message Cloudflare returned.
    case api(message: String)
    /// The response couldn't be interpreted at all — not HTTP, an unbuildable URL, or a body
    /// that doesn't decode as the expected envelope.
    case malformedResponse
}

/// A single DNS record as returned by the Cloudflare API. Distinct from `DNSRecordPayload`
/// (write-only, no `id`/`proxied`) — this is the read-side shape used to list and display
/// existing records.
public struct DNSRecord: Sendable, Equatable, Identifiable {
    /// Cloudflare's record id — the handle `CloudflareWriting.deleteDNSRecord` needs, and the
    /// `Identifiable` identity SwiftUI lists key on.
    public let id: String
    /// Record type as Cloudflare reports it (`A`, `CNAME`, `MX`, `TXT`, …). Left as a string
    /// rather than an enum so unrecognized types still round-trip for display.
    public let type: String
    /// Fully-qualified record name (e.g. `www.example.com`), not the zone-relative label.
    public let name: String
    /// Raw record content exactly as stored (target hostname, IP, TXT payload, …).
    public let content: String
    /// TTL in seconds; `1` is Cloudflare's sentinel for "automatic".
    public let ttl: Int
    /// Whether traffic for this record routes through Cloudflare's proxy (the orange cloud).
    /// Read-side only — `DNSRecordPayload` deliberately doesn't carry it.
    public let proxied: Bool
    /// Memberwise initializer; the HTTP client and test fixtures build records directly.
    public init(id: String, type: String, name: String, content: String, ttl: Int, proxied: Bool) {
        self.id = id
        self.type = type
        self.name = name
        self.content = content
        self.ttl = ttl
        self.proxied = proxied
    }
}

/// Read-only Cloudflare API seam. The concrete `HTTPCloudflareClient` talks to the
/// v4 REST API; tests provide a fake. Token is passed per call (no Keychain coupling).
public protocol CloudflareReading: Sendable {
    /// Resolve a zone's id from its apex domain, or nil if the token can't see it.
    func resolveZoneID(domain: String, apiToken: String) async throws -> String?
    /// Fetch the security-relevant state for a zone. `domain` is the zone's apex hostname
    /// (already known to callers via `resolveZoneID`) — used to scope CAA/MX/SPF/DMARC
    /// grading to the apex, so a record on an unrelated subdomain can't count toward it.
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState
    /// Full DNS record listing for a zone — distinct from `zoneState`'s narrow security-relevant
    /// subset (CAA/MX/SPF/DMARC only). Used by the Domain DNS management feature.
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord]
    /// Every Worker script name (the `id` field) visible to the token's first account. Used to
    /// detect a Worker-name collision before a site's first deploy (#740).
    func workerScriptNames(apiToken: String) async throws -> [String]
}

/// Injectable HTTP boundary — identical shape to `CloudflareAPITokenVerifier.Transport`.
public typealias CloudflareTransport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
