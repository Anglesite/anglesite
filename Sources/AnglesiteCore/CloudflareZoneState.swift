import Foundation

/// A read-only snapshot of a Cloudflare zone's security-relevant edge/DNS state.
/// Assembled by `HTTPCloudflareClient.zoneState` and graded by `SecurityAudit`.
public struct CloudflareZoneState: Sendable, Equatable {
    /// HSTS edge setting (Zone Settings → security_header). `nil` when disabled.
    public struct HSTS: Sendable, Equatable {
        /// `max-age` directive in seconds — how long browsers pin HTTPS for the host.
        public var maxAge: Int
        /// Whether the header carries `includeSubDomains`, extending the pin to every subdomain.
        public var includeSubdomains: Bool
        /// Whether the header carries `preload` — required for hstspreload.org list submission.
        public var preload: Bool
        /// Memberwise initializer; assembled from the zone's `security_header` setting.
        public init(maxAge: Int, includeSubdomains: Bool, preload: Bool) {
            self.maxAge = maxAge
            self.includeSubdomains = includeSubdomains
            self.preload = preload
        }
    }

    /// Whether DNSSEC is actually *active* for the zone — a pending/disabled signing state
    /// reads as `false`, since only active signing protects resolvers.
    public var dnssecActive: Bool
    /// SSL/TLS encryption mode: "off" | "flexible" | "full" | "strict".
    public var sslMode: String
    /// Whether the "Always Use HTTPS" edge redirect (HTTP → HTTPS) is enabled.
    public var alwaysUseHTTPS: Bool
    /// HSTS edge header configuration; `nil` when the `security_header` setting is disabled.
    public var hsts: HSTS?
    /// Raw record contents (`content` field) for the relevant DNS types.
    public var caaRecords: [String]
    /// Apex MX record contents — scoped to the zone apex so a subdomain's mail setup can't
    /// count toward (or against) the apex email grading.
    public var mxRecords: [String]
    /// TXT records whose content starts with `v=spf1`.
    public var spfRecords: [String]
    /// TXT records at `_dmarc.<zone>` whose content starts with `v=DMARC1`.
    public var dmarcRecords: [String]
    /// Whether Bot Fight Mode is enabled (free-plan bot management).
    public var botFightMode: Bool
    /// Custom WAF rules in the `http_request_firewall_custom` phase.
    public var wafCustomRules: [WAFCustomRule]
    /// Speed Brain (speculation-rules prefetching) zone setting.
    public var speedBrain: Bool
    /// Encrypted Client Hello zone setting.
    public var ech: Bool
    /// Whether a compression rule enables Zstandard (`http_response_compression` phase).
    public var zstdCompression: Bool
    /// Page Shield (client-side security) status + detected script hosts. `nil` when unreadable.
    public var pageShield: PageShieldState?
    /// Whether opportunistic Onion Routing is enabled (free, zone-level).
    public var onionRouting: Bool

    /// A single custom WAF rule from the zone's firewall ruleset.
    public struct WAFCustomRule: Sendable, Equatable {
        /// The rule's dashboard description — the identity the hardening planner matches
        /// (case-insensitively) against ``WAFRulePayload/description`` to avoid re-creating a
        /// rule that already exists.
        public var description: String
        /// The rule's match expression in Cloudflare's Rules language, as stored.
        public var expression: String
        /// The rule's action name (`block`, `managed_challenge`, …), as stored.
        public var action: String
        /// Memberwise initializer; mapped from the ruleset listing by the HTTP client.
        public init(description: String, expression: String, action: String) {
            self.description = description
            self.expression = expression
            self.action = action
        }
    }

    /// Page Shield script-monitor snapshot.
    public struct PageShieldState: Sendable, Equatable {
        /// Whether Page Shield monitoring is on for the zone.
        public var enabled: Bool
        /// Unique, sorted hosts of scripts Page Shield has seen loading on the site.
        public var scriptHosts: [String]
        /// Memberwise initializer; assembled from Page Shield's status + script listing calls.
        public init(enabled: Bool, scriptHosts: [String]) {
            self.enabled = enabled
            self.scriptHosts = scriptHosts
        }
    }

    /// Memberwise initializer. Fields added after the original audit (Bot Fight Mode onward) are
    /// defaulted so pre-existing call sites and test fixtures don't churn every time the audit
    /// grows a new check.
    public init(dnssecActive: Bool, sslMode: String, alwaysUseHTTPS: Bool, hsts: HSTS?,
                caaRecords: [String], mxRecords: [String], spfRecords: [String], dmarcRecords: [String],
                botFightMode: Bool = false, wafCustomRules: [WAFCustomRule] = [],
                speedBrain: Bool = false, ech: Bool = false, zstdCompression: Bool = false,
                pageShield: PageShieldState? = nil, onionRouting: Bool = false) {
        self.dnssecActive = dnssecActive
        self.sslMode = sslMode
        self.alwaysUseHTTPS = alwaysUseHTTPS
        self.hsts = hsts
        self.caaRecords = caaRecords
        self.mxRecords = mxRecords
        self.spfRecords = spfRecords
        self.dmarcRecords = dmarcRecords
        self.botFightMode = botFightMode
        self.wafCustomRules = wafCustomRules
        self.speedBrain = speedBrain
        self.ech = ech
        self.zstdCompression = zstdCompression
        self.pageShield = pageShield
        self.onionRouting = onionRouting
    }
}
