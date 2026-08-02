import Foundation

/// The declared-intent model for `Source/anglesite.json` (#1169) — what the app has actually
/// applied to a site's domain, DNS, edge hardening, email, and Workers configuration. Every
/// field is optional except ``version``: an absent file means "no declarations," and each
/// section is only present once something has actually written to it. See the investigation
/// doc (`docs/superpowers/specs/2026-07-31-domain-config-in-git-investigation.md` §5.2) for the
/// schema rationale and the explicit exclusions (secrets, tokens, account/zone/resource IDs,
/// and unmanaged pre-existing DNS records never appear here).
///
/// This type only models the data; ``DomainConfigStore`` owns reading and writing
/// `anglesite.json` itself, including preserving keys this version of the app doesn't know
/// about (git is the source of truth — hand edits and future schema fields must survive a
/// round trip through an app that predates them).
public struct DomainConfig: Equatable, Sendable {
    /// The schema version. Always written; tolerated as absent on read (defaults to `1`) so a
    /// file hand-authored before this field existed still loads.
    public var version: Int
    public var domain: Domain?
    public var dns: DNS?
    public var edge: Edge?
    public var email: Email?
    public var workers: Workers?

    public init(
        version: Int = 1,
        domain: Domain? = nil,
        dns: DNS? = nil,
        edge: Edge? = nil,
        email: Email? = nil,
        workers: Workers? = nil
    ) {
        self.version = version
        self.domain = domain
        self.dns = dns
        self.edge = edge
        self.email = email
        self.workers = workers
    }

    /// The owner's declared hostname and attachment intent — replaces the `DOMAIN`/`DOMAIN_CHOICE`
    /// precedence dance in `.site-config` (see `SiteConfigFile`).
    public struct Domain: Codable, Equatable, Sendable {
        public var hostname: String?
        /// `"buy" | "transfer" | "later"` — kept as an open string (not a closed `enum`) so an
        /// unrecognized value from a future app version or a hand edit degrades gracefully for
        /// the reader instead of failing the whole document to decode.
        public var choice: String?
        public var attach: Bool?
        /// The domain's registrar name, from an RDAP lookup (`RDAPClient`, #1194). `nil` until a
        /// lookup has succeeded at least once.
        public var registrar: String?
        /// The domain's expiration date, as the raw ISO 8601 `eventDate` string RDAP returned —
        /// unparsed, like every other value in this struct; callers format it for display.
        public var expiresAt: String?

        public init(
            hostname: String? = nil, choice: String? = nil, attach: Bool? = nil,
            registrar: String? = nil, expiresAt: String? = nil
        ) {
            self.hostname = hostname
            self.choice = choice
            self.attach = attach
            self.registrar = registrar
            self.expiresAt = expiresAt
        }
    }

    /// DNS records the app created and therefore owns — never a mirror of the owner's whole
    /// zone (investigation doc §5.2/§5.3).
    public struct DNS: Codable, Equatable, Sendable {
        public var managedRecords: [DNSRecord]?

        public init(managedRecords: [DNSRecord]? = nil) {
            self.managedRecords = managedRecords
        }
    }

    /// One app-managed DNS record. `purpose` mirrors the `comment` tag the app stamps on the
    /// live Cloudflare record (e.g. `"email:icloud"`, `"verification:bluesky"`) so declared and
    /// live records can be joined during reconciliation (§5.3).
    public struct DNSRecord: Codable, Equatable, Sendable {
        public var type: String
        public var name: String
        public var content: String
        public var priority: Int?
        public var purpose: String?

        public init(type: String, name: String, content: String, priority: Int? = nil, purpose: String? = nil) {
            self.type = type
            self.name = name
            self.content = content
            self.priority = priority
            self.purpose = purpose
        }
    }

    /// The applied edge-hardening posture — provider-agnostic knobs at this level, Cloudflare-only
    /// ones under ``cloudflare``. Per the owner decision (investigation doc §7.2), this always
    /// serializes exactly the plan the app applied, never an aspirational target.
    public struct Edge: Codable, Equatable, Sendable {
        public var dnssec: Bool?
        public var alwaysUseHTTPS: Bool?
        public var hsts: HSTS?
        public var cloudflare: CloudflareEdge?

        public init(dnssec: Bool? = nil, alwaysUseHTTPS: Bool? = nil, hsts: HSTS? = nil, cloudflare: CloudflareEdge? = nil) {
            self.dnssec = dnssec
            self.alwaysUseHTTPS = alwaysUseHTTPS
            self.hsts = hsts
            self.cloudflare = cloudflare
        }

        public struct HSTS: Codable, Equatable, Sendable {
            public var maxAge: Int?
            public var includeSubdomains: Bool?
            public var preload: Bool?

            public init(maxAge: Int? = nil, includeSubdomains: Bool? = nil, preload: Bool? = nil) {
                self.maxAge = maxAge
                self.includeSubdomains = includeSubdomains
                self.preload = preload
            }
        }

        public struct CloudflareEdge: Codable, Equatable, Sendable {
            public var botFightMode: Bool?
            public var wafRules: [WAFRule]?

            public init(botFightMode: Bool? = nil, wafRules: [WAFRule]? = nil) {
                self.botFightMode = botFightMode
                self.wafRules = wafRules
            }
        }

        /// One Cloudflare WAF custom rule the app applied. Cloudflare-shaped by design —
        /// `cloudflare` is the only provider-specific pocket in the schema (§5.2).
        public struct WAFRule: Codable, Equatable, Sendable {
            public var description: String
            public var expression: String
            public var action: String

            public init(description: String, expression: String, action: String) {
                self.description = description
                self.expression = expression
                self.action = action
            }
        }
    }

    public struct Email: Codable, Equatable, Sendable {
        public var provider: String?
        public var dmarcReportEmail: String?

        public init(provider: String? = nil, dmarcReportEmail: String? = nil) {
            self.provider = provider
            self.dmarcReportEmail = dmarcReportEmail
        }
    }

    /// The owner's active Worker set — moves out of `Config/settings.plist.activeWorkerIDs` in a
    /// later slice (#1172); this slice only models the shape.
    public struct Workers: Codable, Equatable, Sendable {
        public var active: [String]?

        public init(active: [String]? = nil) {
            self.active = active
        }
    }
}

extension DomainConfig: Codable {
    private enum CodingKeys: String, CodingKey {
        case version, domain, dns, edge, email, workers
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        domain = try container.decodeIfPresent(Domain.self, forKey: .domain)
        dns = try container.decodeIfPresent(DNS.self, forKey: .dns)
        edge = try container.decodeIfPresent(Edge.self, forKey: .edge)
        email = try container.decodeIfPresent(Email.self, forKey: .email)
        workers = try container.decodeIfPresent(Workers.self, forKey: .workers)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(domain, forKey: .domain)
        try container.encodeIfPresent(dns, forKey: .dns)
        try container.encodeIfPresent(edge, forKey: .edge)
        try container.encodeIfPresent(email, forKey: .email)
        try container.encodeIfPresent(workers, forKey: .workers)
    }
}
