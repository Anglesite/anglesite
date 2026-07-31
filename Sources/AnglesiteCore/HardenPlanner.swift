/// Pure planner: computes what needs hardening given a zone's current state. No I/O.
public enum HardenPlanner {
    /// The three CAs that Cloudflare's free plan can rotate between for certificate issuance.
    /// Pinning a single CA breaks renewal silently on the next rotation.
    public static let freePlanCAs = ["letsencrypt.org", "digicert.com", "pki.goog"]

    /// The curated WAF rule templates. Up to 5 rules on the free plan.
    public static let curatedWAFRules: [(description: String, expression: String, action: String)] = [
        (
            "Block dotfile paths (except .well-known)",
            """
            (http.request.uri.path contains "/.") and \
            not starts_with(http.request.uri.path, "/.well-known/")
            """,
            "block"
        ),
        (
            "Block .env and .git access",
            """
            (http.request.uri.path contains "/.env") or \
            (http.request.uri.path contains "/.git")
            """,
            "block"
        ),
        (
            "Block path traversal attempts",
            "(http.request.uri.path contains \"/..\")",
            "block"
        ),
        (
            "Block common SQL injection patterns",
            """
            (http.request.uri.query contains "UNION SELECT") or \
            (http.request.uri.query contains "OR 1=1") or \
            (http.request.uri.query contains "'; DROP")
            """,
            "block"
        ),
        (
            "Block XSS patterns in query strings",
            """
            (http.request.uri.query contains "<script") or \
            (http.request.uri.query contains "javascript:") or \
            (http.request.uri.query contains "onerror=")
            """,
            "block"
        ),
    ]

    /// Diffs `state` against the hardening baseline and returns only the missing pieces, so
    /// applying the plan never duplicates records or re-toggles settings that are already right.
    ///
    /// Non-obvious choices: HSTS is (re-)planned when `max-age` is under one year, not just when
    /// absent, since a short `max-age` defeats the point; the email trio (null MX / SPF `-all` /
    /// DMARC reject) is planned **only** for zones with no MX records at all — a mail-receiving
    /// domain must never be handed a null MX; and WAF rules are matched by case-insensitive
    /// description because Cloudflare assigns rule IDs server-side, leaving the description as the
    /// only stable client-side identity. `domain` names the DNS records (CAA/MX/SPF at the apex,
    /// DMARC at `_dmarc.<domain>`).
    public static func plan(from state: CloudflareZoneState, domain: String) -> HardenPlan {
        var items: [HardenPlanItem] = []

        if !state.dnssecActive {
            items.append(.enableDNSSEC)
        }

        for ca in freePlanCAs {
            let alreadyAuthorized = state.caaRecords.contains { $0.lowercased().contains(ca.lowercased()) }
            if !alreadyAuthorized {
                items.append(.addCAARecord(ca: ca))
            }
        }

        if !state.alwaysUseHTTPS {
            items.append(.enableAlwaysUseHTTPS)
        }

        if state.hsts == nil || (state.hsts?.maxAge ?? 0) < 31_536_000 {
            items.append(.enableHSTS(maxAge: 31_536_000, includeSubdomains: true, preload: false))
        }

        if !state.botFightMode {
            items.append(.enableBotFightMode)
        }

        if !state.speedBrain {
            items.append(.enableSpeedBrain)
        }
        if !state.zstdCompression {
            items.append(.enableZstandardCompression)
        }
        if !state.ech {
            items.append(.enableECH)
        }
        if state.pageShield?.enabled != true {
            items.append(.enablePageShieldMonitoring)
        }

        // Email hardening only for domains that don't send mail.
        if state.mxRecords.isEmpty {
            items.append(.addNullMX)
            if state.spfRecords.isEmpty || !state.spfRecords.contains(where: { $0.lowercased().hasSuffix(" -all") }) {
                items.append(.addSPFRejectAll)
            }
            let hasDMARCReject = state.dmarcRecords.contains { record in
                dmarcHasPolicy(record, policy: "reject")
            }
            if !hasDMARCReject {
                items.append(.addDMARCReject)
            }
        }

        let existingDescriptions = Set(state.wafCustomRules.map { $0.description.lowercased() })
        for rule in curatedWAFRules {
            if !existingDescriptions.contains(rule.description.lowercased()) {
                items.append(.addWAFRule(description: rule.description,
                                        expression: rule.expression, action: rule.action))
            }
        }

        return HardenPlan(items: items)
    }
}

/// Checks whether a DMARC record contains `p=<policy>` (not `sp=<policy>`).
func dmarcHasPolicy(_ record: String, policy: String) -> Bool {
    let lower = record.lowercased()
    let target = policy.lowercased()
    var search = lower.startIndex
    while let range = lower.range(of: "p=", range: search..<lower.endIndex) {
        if range.lowerBound == lower.startIndex
            || lower[lower.index(before: range.lowerBound)] == ";"
            || lower[lower.index(before: range.lowerBound)] == " " {
            let value = lower[range.upperBound...]
            if value.hasPrefix(target) { return true }
        }
        search = range.upperBound
    }
    return false
}
