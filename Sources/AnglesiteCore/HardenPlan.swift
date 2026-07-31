/// A computed set of Cloudflare hardening changes, ready for preview and opt-in application.
public struct HardenPlan: Sendable, Equatable {
    /// The changes to apply, in `HardenPlanner`'s emission order — which is also the order
    /// ``summary`` previews them and `HardenExecutor` applies them.
    public let items: [HardenPlanItem]
    /// True when the zone already matches the hardening baseline and there is nothing to apply.
    public var isEmpty: Bool { items.isEmpty }

    /// Creates a plan. Normally produced by `HardenPlanner.plan(from:domain:)`; direct
    /// construction is for tests.
    public init(items: [HardenPlanItem]) {
        self.items = items
    }

    /// Human-readable preview shown before the user opts in: one `+`-prefixed line per item, or an
    /// explicit "fully hardened" sentence — an empty preview would read as a bug, not success.
    public var summary: String {
        if items.isEmpty { return "Zone is fully hardened. No changes needed." }
        return items.map(\.description).joined(separator: "\n")
    }
}

/// A single hardening change to apply to a Cloudflare zone.
public enum HardenPlanItem: Sendable, Hashable, CustomStringConvertible {
    /// Enable DNSSEC signing for the zone.
    case enableDNSSEC
    /// Add a `0 issue "<ca>"` CAA record authorizing `ca` to issue certificates. Planned once per
    /// CA in `HardenPlanner.freePlanCAs` — Cloudflare's free plan rotates between those CAs, so
    /// authorizing only one would silently break the next renewal.
    case addCAARecord(ca: String)
    /// Turn on Cloudflare's Always Use HTTPS redirect for all plain-HTTP requests.
    case enableAlwaysUseHTTPS
    /// Enable HSTS with the given directives. The planner passes `preload: false` — preload-list
    /// enrollment is effectively irreversible and shouldn't be a silent side effect of a
    /// one-click hardening pass.
    case enableHSTS(maxAge: Int, includeSubdomains: Bool, preload: Bool)
    /// Enable Bot Fight Mode, the free-plan automated-bot mitigation.
    case enableBotFightMode
    /// Add an RFC 7505 null MX (`0 .`) declaring the domain receives no mail. Only planned for
    /// zones with no existing MX records.
    case addNullMX
    /// Add a `v=spf1 -all` TXT record so mail spoofed from this non-sending domain hard-fails SPF.
    case addSPFRejectAll
    /// Add a `v=DMARC1; p=reject` record at `_dmarc.<domain>` so receivers discard spoofed mail
    /// outright instead of quarantining it.
    case addDMARCReject
    /// Create one WAF custom rule (from `HardenPlanner.curatedWAFRules`). The description doubles
    /// as the dedupe key on re-plan, since Cloudflare assigns rule IDs server-side.
    case addWAFRule(description: String, expression: String, action: String)
    /// Enable Speed Brain (speculative prefetching).
    case enableSpeedBrain
    /// Enable Zstandard response compression.
    case enableZstandardCompression
    /// Enable Encrypted Client Hello, hiding the requested hostname from on-path observers.
    case enableECH
    /// Enable Page Shield's client-side script monitoring — monitoring only, so it can't break
    /// the site the way a blocking policy could.
    case enablePageShieldMonitoring

    /// One diff-style `+`-prefixed preview line; ``HardenPlan/summary`` joins these into the
    /// opt-in preview the user approves.
    public var description: String {
        switch self {
        case .enableDNSSEC:
            return "+ Enable DNSSEC"
        case .addCAARecord(let ca):
            return "+ Add CAA record: 0 issue \"\(ca)\""
        case .enableAlwaysUseHTTPS:
            return "+ Enable Always Use HTTPS"
        case .enableHSTS(let maxAge, let subs, let preload):
            var parts = "max-age=\(maxAge)"
            if subs { parts += "; includeSubDomains" }
            if preload { parts += "; preload" }
            return "+ Enable HSTS (\(parts))"
        case .enableBotFightMode:
            return "+ Enable Bot Fight Mode"
        case .addNullMX:
            return "+ Add null MX record (0 .)"
        case .addSPFRejectAll:
            return "+ Add SPF record: v=spf1 -all"
        case .addDMARCReject:
            return "+ Add DMARC record: v=DMARC1; p=reject"
        case .addWAFRule(let desc, _, let action):
            return "+ Add WAF rule [\(action)]: \(desc)"
        case .enableSpeedBrain:
            return "+ Enable Speed Brain (speculative prefetching)"
        case .enableZstandardCompression:
            return "+ Enable Zstandard compression"
        case .enableECH:
            return "+ Enable Encrypted Client Hello (ECH)"
        case .enablePageShieldMonitoring:
            return "+ Enable client-side script monitoring (Page Shield)"
        }
    }
}
