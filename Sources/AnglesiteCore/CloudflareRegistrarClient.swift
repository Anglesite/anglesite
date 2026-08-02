import Foundation

/// One Check result — real-time availability + pricing, or the reason a candidate isn't
/// registrable. `registrationCost`/`currency` are `nil` exactly when `registrable` is `false`.
public struct RegistrarDomainCheck: Sendable, Equatable {
    public let name: String
    public let registrable: Bool
    /// Set when `registrable` is `false` — e.g. `domain_unavailable`,
    /// `extension_not_supported_via_api`, `extension_not_supported`,
    /// `extension_disallows_registration`.
    public let reason: String?
    public let registrationCost: String?
    public let currency: String?

    public init(name: String, registrable: Bool, reason: String?, registrationCost: String?, currency: String?) {
        self.name = name
        self.registrable = registrable
        self.reason = reason
        self.registrationCost = registrationCost
        self.currency = currency
    }
}

/// Read-only Cloudflare Registrar API seam (search + check), deliberately separate from
/// `CloudflareReading` — see this plan's Global Constraints for why. The concrete
/// `HTTPCloudflareClient` conforms via an extension; tests provide a fake.
public protocol CloudflareRegistrarReading: Sendable {
    /// Candidate domain names for a keyword/phrase (cached server-side by Cloudflare). Availability
    /// and pricing come back with each candidate too, but are not authoritative — follow up with
    /// `checkDomainAvailability` for a real-time, registry-authoritative answer before registering.
    func searchDomains(query: String, apiToken: String) async throws -> [String]
    /// Real-time availability + pricing for up to 20 domain names in one call (the API's own cap).
    func checkDomainAvailability(domains: [String], apiToken: String) async throws -> [RegistrarDomainCheck]
}
