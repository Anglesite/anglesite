/// Pure evaluator: grades a `CloudflareZoneState` into security findings. Read-only,
/// no I/O — it never fixes anything. Findings reuse the shared `AuditReport.Finding`
/// model (`category: .security`).
public enum SecurityAudit {
    /// Grades a zone snapshot against Anglesite's baseline: DNSSEC, origin TLS validation
    /// (Full-strict), HTTPS enforcement, HSTS lifetime, bot mitigation, CAA, mail-spoofing
    /// lockdown, ECH, and client-side script monitoring.
    ///
    /// - Parameters:
    ///   - state: The read-only Cloudflare zone snapshot to grade.
    ///   - expectsMail: Whether the domain legitimately sends mail. When `false`, a missing
    ///     `v=spf1 -all` / DMARC `p=reject` lockdown is flagged — a non-sending domain without
    ///     them is trivially spoofable. When `true`, SPF/DMARC checks are skipped entirely:
    ///     the mail setup flow owns that DNS, and flagging its records here would produce
    ///     remediation advice that breaks the owner's mail.
    /// - Returns: Findings (all `category: .security`); empty when the zone already meets the
    ///   baseline.
    public static func evaluate(_ state: CloudflareZoneState, expectsMail: Bool) -> [AuditReport.Finding] {
        var findings: [AuditReport.Finding] = []
        func add(_ severity: AuditReport.Finding.Severity, _ title: String, _ detail: String, _ remediation: String) {
            findings.append(.init(category: .security, severity: severity, title: title,
                                  detail: detail, remediation: remediation, location: nil))
        }

        if !state.dnssecActive {
            add(.warning, "DNSSEC is not active",
                "DNSSEC is disabled, leaving DNS responses unauthenticated.",
                "Enable DNSSEC for the zone and publish the DS record at your registrar.")
        }
        switch state.sslMode.lowercased() {
        case "strict":
            break // Full (strict): origin cert validated — the secure target.
        case "full":
            add(.warning, "SSL/TLS mode is Full but not Strict",
                "Full mode encrypts the Cloudflare↔origin hop but does not validate the origin certificate, leaving it open to an active MITM on that hop.",
                "Set the zone's SSL/TLS mode to Full (strict).")
        default:
            add(.critical, "Weak SSL/TLS mode (\(state.sslMode))",
                "SSL mode \"\(state.sslMode)\" allows unencrypted or unauthenticated origin connections.",
                "Set the zone's SSL/TLS mode to Full (strict).")
        }
        if !state.alwaysUseHTTPS {
            add(.warning, "Always Use HTTPS is off",
                "Visitors can reach the site over plaintext HTTP.",
                "Enable Always Use HTTPS so HTTP requests are redirected to HTTPS.")
        }
        if state.hsts == nil {
            add(.warning, "HSTS is not enabled",
                "Without HSTS, browsers may downgrade to HTTP on the first visit.",
                "Enable HTTP Strict Transport Security (max-age ≥ 1 year, includeSubDomains).")
        } else if let h = state.hsts, h.maxAge < 31_536_000 {
            add(.warning, "HSTS max-age is short (\(h.maxAge)s)",
                "An HSTS max-age under one year weakens downgrade protection.",
                "Raise HSTS max-age to at least 31536000 (one year).")
        }
        if !state.botFightMode {
            add(.info, "Bot Fight Mode is off",
                "Without Bot Fight Mode, automated threats are not challenged at the edge.",
                "Enable Bot Fight Mode to challenge bots before they reach the site.")
        }
        if state.caaRecords.isEmpty {
            add(.info, "No CAA records",
                "Any certificate authority can issue certificates for this domain.",
                "Add CAA records authorizing only your CA(s) to limit mis-issuance.")
        }
        if !expectsMail {
            if state.spfRecords.isEmpty || !state.spfRecords.contains(where: { $0.lowercased().hasSuffix(" -all") }) {
                add(.warning, "No strict SPF record",
                    "A domain that does not send mail should publish SPF \"v=spf1 -all\" to block spoofing.",
                    "Publish a TXT record: v=spf1 -all")
            }
            if !state.dmarcRecords.contains(where: { dmarcHasPolicy($0, policy: "reject") }) {
                add(.warning, "No DMARC reject policy",
                    "Without DMARC p=reject, spoofed mail claiming to be from this domain is not blocked.",
                    "Publish _dmarc TXT: v=DMARC1; p=reject")
            }
        }
        if !state.ech {
            add(.info, "Encrypted Client Hello is off",
                "Without ECH, the site hostname is visible in plaintext during TLS handshakes.",
                "Enable Encrypted Client Hello (ECH) in the zone's TLS settings.")
        }
        if state.pageShield?.enabled != true {
            add(.info, "Client-side script monitoring is off",
                "Page Shield is not watching which scripts run on the site, so a compromised third-party script would go unnoticed.",
                "Enable Page Shield's script monitor (free on all plans).")
        } else if let shield = state.pageShield, !shield.scriptHosts.isEmpty {
            add(.info, "Third-party scripts detected",
                "Page Shield sees scripts loading from: \(shield.scriptHosts.joined(separator: ", ")).",
                "Review each host; remove any you don't recognize and keep the CSP in sync.")
        }
        return findings
    }
}
