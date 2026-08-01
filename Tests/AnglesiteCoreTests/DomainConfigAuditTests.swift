import Testing
@testable import AnglesiteCore

struct DomainConfigAuditTests {
    private let domain = "example.com"

    private func cleanZoneState(
        dnssecActive: Bool = true,
        alwaysUseHTTPS: Bool = true,
        hsts: CloudflareZoneState.HSTS? = .init(maxAge: 31_536_000, includeSubdomains: true, preload: false),
        botFightMode: Bool = true,
        wafCustomRules: [CloudflareZoneState.WAFCustomRule] = []
    ) -> CloudflareZoneState {
        CloudflareZoneState(
            dnssecActive: dnssecActive, sslMode: "strict", alwaysUseHTTPS: alwaysUseHTTPS,
            hsts: hsts, caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [],
            botFightMode: botFightMode, wafCustomRules: wafCustomRules)
    }

    @Test("no drift when declared is empty and nothing is tagged live")
    func noDriftOnEmptyDeclared() {
        let findings = DomainConfigAudit.evaluate(
            declared: DomainConfig(), live: cleanZoneState(), liveDNSRecords: [], domain: domain)
        #expect(findings.isEmpty)
    }

    @Test("flags a missing managed DNS record as auto-applicable")
    func missingManagedRecordIsAutoApplicable() {
        let declaredRecord = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:abc", purpose: "verification:bluesky")
        let declared = DomainConfig(dns: .init(managedRecords: [declaredRecord]))

        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(), liveDNSRecords: [], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].category == .dns)
        #expect(findings[0].remediation == .autoApply(.createManagedRecord(declaredRecord)))
    }

    @Test("in-sync managed record produces no finding")
    func inSyncManagedRecordProducesNoFinding() {
        let declaredRecord = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:abc", purpose: "verification:bluesky")
        let declared = DomainConfig(dns: .init(managedRecords: [declaredRecord]))
        let live = [DNSRecord(id: "r1", type: "TXT", name: "_atproto.example.com",
                              content: "did=did:plc:abc", ttl: 1, proxied: false,
                              comment: "anglesite:verification:bluesky")]

        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(), liveDNSRecords: live, domain: domain)

        #expect(findings.isEmpty)
    }

    @Test("flags drifted content on a managed non-MX record as auto-applicable")
    func driftedNonMXRecordIsAutoApplicable() {
        let declaredRecord = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:NEW", purpose: "verification:bluesky")
        let declared = DomainConfig(dns: .init(managedRecords: [declaredRecord]))
        let staleLive = DNSRecord(id: "r1", type: "TXT", name: "_atproto.example.com",
                                  content: "did=did:plc:OLD", ttl: 1, proxied: false,
                                  comment: "anglesite:verification:bluesky")

        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(), liveDNSRecords: [staleLive], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].category == .dns)
        #expect(findings[0].remediation == .autoApply(
            .replaceManagedRecord(staleRecordID: "r1", declared: declaredRecord)))
    }

    @Test("flags an MX conflict with an untagged live record as an owner question, not auto-apply")
    func mxConflictWithUntaggedRecordIsOwnerQuestion() {
        let declaredRecord = DomainConfig.DNSRecord(
            type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10, purpose: "email:icloud")
        let declared = DomainConfig(dns: .init(managedRecords: [declaredRecord]))
        let untaggedLiveMX = DNSRecord(id: "r1", type: "MX", name: "example.com",
                                       content: "aspmx.l.google.com", ttl: 1, proxied: false, comment: nil)

        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(), liveDNSRecords: [untaggedLiveMX], domain: domain)

        #expect(findings.count == 1)
        guard case .ownerQuestion(let question) = findings[0].remediation else {
            Issue.record("expected an owner question, got \(findings[0].remediation)")
            return
        }
        #expect(question.contains("mail"))
    }

    @Test("auto-applies a missing MX record when no untagged live MX record exists")
    func missingMXRecordAutoAppliesWithNoConflict() {
        let declaredRecord = DomainConfig.DNSRecord(
            type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10, purpose: "email:icloud")
        let declared = DomainConfig(dns: .init(managedRecords: [declaredRecord]))

        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(), liveDNSRecords: [], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].remediation == .autoApply(.createManagedRecord(declaredRecord)))
    }

    @Test("ignores untagged live records with no declared counterpart entirely")
    func ignoresUntaggedLiveRecords() {
        let untagged = DNSRecord(id: "r1", type: "A", name: "example.com", content: "192.0.2.1",
                                 ttl: 300, proxied: true, comment: nil)
        let findings = DomainConfigAudit.evaluate(
            declared: DomainConfig(), live: cleanZoneState(), liveDNSRecords: [untagged], domain: domain)
        #expect(findings.isEmpty)
    }

    @Test("flags an orphaned anglesite-tagged live record with no declared counterpart as informational")
    func orphanedTaggedRecordIsInformational() {
        let orphan = DNSRecord(id: "r1", type: "TXT", name: "_atproto.example.com",
                               content: "did=did:plc:abc", ttl: 1, proxied: false,
                               comment: "anglesite:verification:bluesky")
        let findings = DomainConfigAudit.evaluate(
            declared: DomainConfig(), live: cleanZoneState(), liveDNSRecords: [orphan], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].category == .dns)
        #expect(findings[0].remediation == .informational)
    }

    @Test("flags missing DNSSEC as auto-applicable edge drift")
    func missingDNSSECIsAutoApplicable() {
        let declared = DomainConfig(edge: .init(dnssec: true))
        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(dnssecActive: false), liveDNSRecords: [], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].category == .edge)
        #expect(findings[0].remediation == .autoApply(.hardenEdge(.enableDNSSEC)))
    }

    @Test("flags missing Always Use HTTPS as auto-applicable edge drift")
    func missingAlwaysUseHTTPSIsAutoApplicable() {
        let declared = DomainConfig(edge: .init(alwaysUseHTTPS: true))
        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(alwaysUseHTTPS: false), liveDNSRecords: [], domain: domain)

        #expect(findings.contains(.init(category: .edge, title: "Always Use HTTPS is off",
                                        detail: "Declared but not applied on the live zone.",
                                        remediation: .autoApply(.hardenEdge(.enableAlwaysUseHTTPS)))))
    }

    @Test("flags mismatched declared HSTS as auto-applicable edge drift")
    func mismatchedHSTSIsAutoApplicable() {
        let declaredHSTS = DomainConfig.Edge.HSTS(maxAge: 31_536_000, includeSubdomains: true, preload: false)
        let declared = DomainConfig(edge: .init(hsts: declaredHSTS))
        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(hsts: nil), liveDNSRecords: [], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].remediation == .autoApply(.hardenEdge(
            .enableHSTS(maxAge: 31_536_000, includeSubdomains: true, preload: false))))
    }

    @Test("declared HSTS matching live produces no finding")
    func matchingHSTSProducesNoFinding() {
        let declaredHSTS = DomainConfig.Edge.HSTS(maxAge: 31_536_000, includeSubdomains: true, preload: false)
        let declared = DomainConfig(edge: .init(hsts: declaredHSTS))
        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(), liveDNSRecords: [], domain: domain)
        #expect(findings.isEmpty)
    }

    @Test("flags missing Bot Fight Mode as auto-applicable edge drift")
    func missingBotFightModeIsAutoApplicable() {
        let declared = DomainConfig(edge: .init(cloudflare: .init(botFightMode: true)))
        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(botFightMode: false), liveDNSRecords: [], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].remediation == .autoApply(.hardenEdge(.enableBotFightMode)))
    }

    @Test("flags a missing declared WAF rule as auto-applicable")
    func missingWAFRuleIsAutoApplicable() {
        let rule = DomainConfig.Edge.WAFRule(description: "Block dotfiles", expression: "(x)", action: "block")
        let declared = DomainConfig(edge: .init(cloudflare: .init(wafRules: [rule])))
        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: cleanZoneState(), liveDNSRecords: [], domain: domain)

        #expect(findings.count == 1)
        #expect(findings[0].remediation == .autoApply(.hardenEdge(
            .addWAFRule(description: "Block dotfiles", expression: "(x)", action: "block"))))
    }

    @Test("declared WAF rule already live produces no finding")
    func matchingWAFRuleProducesNoFinding() {
        let rule = DomainConfig.Edge.WAFRule(description: "Block dotfiles", expression: "(x)", action: "block")
        let declared = DomainConfig(edge: .init(cloudflare: .init(wafRules: [rule])))
        let live = cleanZoneState(wafCustomRules: [
            .init(description: "Block dotfiles", expression: "(x)", action: "block"),
        ])
        let findings = DomainConfigAudit.evaluate(
            declared: declared, live: live, liveDNSRecords: [], domain: domain)
        #expect(findings.isEmpty)
    }

    @Test("no edge findings when nothing is declared, regardless of live state")
    func noEdgeFindingsWhenNothingDeclared() {
        let findings = DomainConfigAudit.evaluate(
            declared: DomainConfig(), live: cleanZoneState(dnssecActive: false, alwaysUseHTTPS: false),
            liveDNSRecords: [], domain: domain)
        #expect(findings.isEmpty)
    }
}
