/// A permission group the stored Cloudflare token has been *observed* to have, via
/// `CloudflareCapabilityProber`. Capabilities are read-probe signals: presence means the token can
/// at least read that product's API; absence (401/403 on the probe) means a wizard needing it must
/// route the user through token re-onboarding (`AnglesiteTokenTemplate`) instead of failing mid-flow.
public enum TokenCapability: String, CaseIterable, Codable, Sendable {
    /// Workers scripts (deploy).
    case workers
    /// Zone settings (SSL mode, HSTS, Speed Brain, ECH, …).
    case zoneSettings
    /// DNS record reads/writes.
    case dns
    /// Zone rulesets (WAF custom rules, compression rules).
    case rulesets
    /// Turnstile widget management.
    case turnstile
    /// Email Routing (rules + destination addresses).
    case emailRouting
    /// Zaraz configuration.
    case zaraz
    /// Page Shield (client-side security) status + script reports.
    case pageShield
    /// Registrar domain search/registration.
    case registrar
    /// Workers KV namespace management (list/create) — used to gate inbox-capture provisioning
    /// (#764).
    case kv
}

/// The set of permission groups a probe observed on the stored token.
public typealias TokenCapabilities = Set<TokenCapability>
