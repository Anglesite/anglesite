import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Observes which permission groups a stored Cloudflare token actually has, by issuing one cheap
/// authenticated GET per group. 401/403 means the group is missing; any other response (including
/// 404s like "Email Routing not enabled") proves the permission. A thrown transport error counts as
/// missing — probes are advisory and callers may re-probe.
///
/// This exists so wizards can gate on `TokenCapabilities` up front and route the user through token
/// re-onboarding (`AnglesiteTokenTemplate`) instead of failing halfway through an API orchestration.
public struct CloudflareCapabilityProber: Sendable {
    private let baseURL: URL
    private let transport: CloudflareTransport

    /// Creates a prober. Both parameters exist for tests — `baseURL` points at a stub server,
    /// `transport` fakes the HTTP layer entirely; production callers take the defaults.
    public init(
        baseURL: URL = URL(string: "https://api.cloudflare.com/client/v4")!,
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) {
        self.baseURL = baseURL
        self.transport = transport
    }

    /// Probes each known capability with one authenticated GET and returns the set that answered
    /// with anything other than 401/403. Account-scoped probes are skipped entirely when the
    /// token can't list an account, and zone-scoped probes when `zoneID` is `nil` — so absence
    /// from the result means "not proven", not necessarily "denied"; gate optimistically-missing
    /// capabilities by re-probing once the zone is known rather than caching this as final.
    public func probe(token: String, zoneID: String?) async -> TokenCapabilities {
        var caps = TokenCapabilities()

        var probes: [(TokenCapability, String)] = []
        if let accountID = await firstAccountID(token: token) {
            probes += [
                (.workers, "accounts/\(accountID)/workers/scripts"),
                (.turnstile, "accounts/\(accountID)/challenges/widgets"),
                (.registrar, "accounts/\(accountID)/registrar/domains"),
                (.kv, "accounts/\(accountID)/storage/kv/namespaces?per_page=1"),
            ]
        }
        if let zoneID {
            probes += [
                (.zoneSettings, "zones/\(zoneID)/settings/ssl"),
                (.dns, "zones/\(zoneID)/dns_records?per_page=1"),
                (.rulesets, "zones/\(zoneID)/rulesets"),
                (.emailRouting, "zones/\(zoneID)/email/routing"),
                (.zaraz, "zones/\(zoneID)/settings/zaraz/config"),
                (.pageShield, "zones/\(zoneID)/page_shield"),
            ]
        }
        for (cap, path) in probes {
            if await allowed(path, token: token) {
                caps.insert(cap)
            }
        }
        return caps
    }

    /// First account id visible to the token, or nil (account-scoped probes are then skipped).
    private func firstAccountID(token: String) async -> String? {
        struct Envelope: Decodable { let result: [Account]?; struct Account: Decodable { let id: String } }
        guard let (data, http) = try? await get("accounts?per_page=1", token: token),
              (200..<300).contains(http.statusCode),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
        else { return nil }
        return envelope.result?.first?.id
    }

    private func allowed(_ path: String, token: String) async -> Bool {
        guard let (_, http) = try? await get(path, token: token) else { return false }
        return http.statusCode != 401 && http.statusCode != 403
    }

    private func get(_ path: String, token: String) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: baseURL.absoluteString + "/" + path) else {
            throw CloudflareError.malformedResponse
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await transport(request)
    }
}
