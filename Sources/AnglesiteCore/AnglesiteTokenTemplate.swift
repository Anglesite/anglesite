import Foundation

/// The single "Anglesite" Cloudflare API token: one custom template carrying every permission the
/// app can use across deploy, harden, and the integration wizards (spec:
/// docs/superpowers/specs/2026-07-04-cloudflare-free-services-integration-design.md §4).
///
/// The dashboard pre-fill query params are undocumented; if Cloudflare changes the schema the link
/// still lands on the token page and the prompt tells the user to fall back to at least the built-in
/// Edit Cloudflare Workers permissions, so deploy keeps working and feature wizards re-prompt for the
/// rest, so the flow degrades rather than breaks (verified pre-fill behavior last on 2026-06-16 for
/// the original five groups).
public enum AnglesiteTokenTemplate {
    /// The token's display name, pre-filled into the dashboard form so the owner can recognize —
    /// and later audit or revoke — the app's token among any others on their account.
    public static let tokenName = "Anglesite"

    /// Dashboard permission-group keys with their access level. Order is display order.
    ///
    /// `response_compression` and the `page_shield` access level are best-known and unverified
    /// against the live dashboard (same degrade-gracefully caveat as the rest): Harden's Zstandard
    /// write targets the `http_response_compression` ruleset phase, which is governed by the
    /// Response Compression permission group, not `zone_waf`; and Page Shield needs write access
    /// because Harden enables the script monitor via a `PUT`, not just reads its state.
    public static let permissionGroups: [(key: String, type: String)] = [
        // Deploy (the original "Edit Cloudflare Workers" set)
        ("workers_routes", "edit"),
        ("workers_scripts", "edit"),
        ("workers_kv_storage", "edit"),
        ("workers_tail", "read"),
        ("workers_r2", "edit"),
        ("d1", "edit"),
        // Harden + zone state
        ("zone_settings", "edit"),
        ("dns", "edit"),
        ("zone_waf", "edit"),
        ("response_compression", "edit"),
        ("page_shield", "edit"),
        ("analytics", "read"),
        // Integration wizards (slices 1, 2, 5, 7)
        ("challenge_widgets", "edit"),
        ("email_routing_rules", "edit"),
        ("email_routing_addresses", "edit"),
        ("zaraz", "edit"),
        ("registrar", "edit"),
    ]

    /// The OAuth `scope` string covering every permission group above. Cloudflare's self-managed
    /// OAuth scope names equal API-token permission-group names, so this is the same list,
    /// space-joined per OAuth's multi-scope convention — not a separately maintained vocabulary.
    public static var oauthScope: String {
        permissionGroups.map(\.key).joined(separator: " ")
    }

    /// The dashboard deep link that pre-fills the whole template: name, all accounts/zones (the
    /// one token must cover every site the owner deploys), and ``permissionGroups`` encoded as a
    /// JSON array in a query param. Built with `URLComponents` so that JSON payload is
    /// percent-escaped rather than hand-assembled. See the type-level note for what happens if
    /// Cloudflare stops honoring these undocumented params.
    public static var createTokenURL: URL {
        let permissions = "[" + permissionGroups
            .map { #"{"key":"\#($0.key)","type":"\#($0.type)"}"# }
            .joined(separator: ",") + "]"
        var components = URLComponents(string: "https://dash.cloudflare.com/profile/api-tokens")!
        components.queryItems = [
            URLQueryItem(name: "name", value: tokenName),
            URLQueryItem(name: "accountId", value: "*"),
            URLQueryItem(name: "zoneId", value: "all"),
            URLQueryItem(name: "permissionGroupKeys", value: permissions),
        ]
        return components.url!
    }
}
