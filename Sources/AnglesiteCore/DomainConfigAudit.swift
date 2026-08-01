/// Pure evaluator: diffs a site's declared `Source/anglesite.json` (`DomainConfig`, #1169)
/// against its live Cloudflare state (`CloudflareZoneState` + `listDNSRecords`, #406) and reports
/// drift. Read-only, no I/O — mirrors `SecurityAudit`'s idiom, extended to also grade DNS records
/// (`SecurityAudit` only grades the narrow CAA/MX/SPF/DMARC subset `CloudflareZoneState` carries).
///
/// Managed DNS records are joined to their live counterpart via the `anglesite:<purpose>` record
/// `comment` stamp (#1170, investigation doc §5.3) — never by content alone, since content is
/// exactly what can drift. A live record with no `anglesite:` comment is never inspected: it's
/// external by definition and the abort-don't-clobber posture falls out of not touching it.
public enum DomainConfigAudit {
    /// One piece of drift between declared and live state.
    public struct Finding: Sendable, Equatable, Identifiable {
        public enum Category: String, Sendable, Equatable {
            case dns
            case edge
        }

        /// How this finding should be resolved, per the "app advises" rule (investigation doc
        /// §5.5): unambiguous app-owned drift auto-applies; contested state asks the owner a
        /// question phrased about consequences to their site, never about git/diffs; some
        /// findings (an untracked live record the app once created but no longer declares) are
        /// surfaced with no action at all — the app was never told to touch it.
        public enum Remediation: Sendable, Equatable {
            /// Safe to apply without asking — resolves to one `DomainConfigReconcileItem`.
            case autoApply(DomainConfigReconcileItem)
            /// Needs the owner's call; the string is the consequences-phrased question to show.
            case ownerQuestion(String)
            /// Surfaced for awareness only; no action is offered.
            case informational
        }

        public let category: Category
        public let title: String
        public let detail: String
        public let remediation: Remediation

        /// Memberwise initializer.
        public init(category: Category, title: String, detail: String, remediation: Remediation) {
            self.category = category
            self.title = title
            self.detail = detail
            self.remediation = remediation
        }

        /// Content-derived identity, matching `AuditReport.Finding`'s rationale: the same drift
        /// keeps the same id across re-audits so a SwiftUI list updates rows in place.
        public var id: String { "\(category.rawValue):\(title):\(detail)" }
    }

    /// Grades declared `anglesite.json` state against a fresh Cloudflare read.
    ///
    /// - Parameters:
    ///   - declared: The site's `Source/anglesite.json`, as loaded by `DomainConfigStore`.
    ///   - live: The zone's security-relevant edge/DNS state (graded fields only).
    ///   - liveDNSRecords: The zone's full DNS record listing (for the managed-record join,
    ///     which needs the `comment` field `CloudflareZoneState` doesn't carry).
    ///   - domain: The zone's apex hostname, to expand a declared record's zone-relative `name`
    ///     (`"@"`, `"_atproto"`) into the fully-qualified form live records report.
    /// - Returns: Findings in declared-record, then declared-edge-field order; empty when nothing
    ///   has drifted.
    public static func evaluate(
        declared: DomainConfig,
        live: CloudflareZoneState,
        liveDNSRecords: [DNSRecord],
        domain: String
    ) -> [Finding] {
        evaluateDNS(declared: declared, liveDNSRecords: liveDNSRecords, domain: domain)
            + evaluateEdge(declared: declared, live: live)
    }

    // MARK: - DNS

    private static func evaluateDNS(
        declared: DomainConfig, liveDNSRecords: [DNSRecord], domain: String
    ) -> [Finding] {
        var findings: [Finding] = []
        var matchedLiveIDs = Set<String>()

        for record in declared.dns?.managedRecords ?? [] {
            let fqName = fullyQualifiedName(record.name, domain: domain)
            let expectedComment = record.purpose.map { "anglesite:\($0)" }
            let candidates = liveDNSRecords.filter {
                expectedComment != nil
                    ? $0.comment == expectedComment
                    : $0.type.caseInsensitiveCompare(record.type) == .orderedSame
                        && $0.name.caseInsensitiveCompare(fqName) == .orderedSame
            }
            candidates.forEach { matchedLiveIDs.insert($0.id) }

            // MX is multi-valued and shared with the owner's other mail setup, unlike every other
            // record type here — adding our declared MX alongside an untagged (not app-managed)
            // one already live could silently split mail delivery between two providers, so this
            // is the one case that must ask rather than auto-apply.
            if record.type.caseInsensitiveCompare("MX") == .orderedSame,
               let conflicting = liveDNSRecords.first(where: {
                   $0.type.caseInsensitiveCompare("MX") == .orderedSame
                       && $0.name.caseInsensitiveCompare(fqName) == .orderedSame
                       && !isAnglesiteTagged($0)
               }) {
                matchedLiveIDs.insert(conflicting.id)
                findings.append(.init(
                    category: .dns,
                    title: "Existing mail record may conflict",
                    detail: "Declared MX record \(record.content) for \(record.name) wasn't reconciled because an untracked MX record (\(conflicting.content)) is already live.",
                    remediation: .ownerQuestion(
                        "Your domain already has a mail (MX) record pointing to \(conflicting.content) that Anglesite didn't set up. Adding Anglesite's declared record for \(record.content) alongside it could disrupt your existing mail delivery. Keep the existing record and leave this alone?")))
                continue
            }

            guard let liveMatch = candidates.first else {
                findings.append(.init(
                    category: .dns,
                    title: "Missing managed DNS record",
                    detail: "\(record.type) record \(record.name) is declared but not live.",
                    remediation: .autoApply(.createManagedRecord(record))))
                continue
            }

            if liveMatch.content != record.content {
                findings.append(.init(
                    category: .dns,
                    title: "Managed DNS record content drifted",
                    detail: "\(record.type) record \(record.name) is declared as \(record.content) but live as \(liveMatch.content).",
                    remediation: .autoApply(.replaceManagedRecord(staleRecordID: liveMatch.id, declared: record))))
            }
        }

        for live in liveDNSRecords where isAnglesiteTagged(live) && !matchedLiveIDs.contains(live.id) {
            findings.append(.init(
                category: .dns,
                title: "Untracked Anglesite-managed record",
                detail: "\(live.type) record \(live.name) is tagged \(live.comment ?? "") but anglesite.json no longer declares it.",
                remediation: .informational))
        }

        return findings
    }

    private static func isAnglesiteTagged(_ record: DNSRecord) -> Bool {
        record.comment?.hasPrefix("anglesite:") == true
    }

    /// Inverse of `DomainOperationsService`'s private `relativeName` — expands a declared
    /// zone-relative name (`"@"` for the apex) into the fully-qualified form `listDNSRecords`
    /// reports.
    private static func fullyQualifiedName(_ name: String, domain: String) -> String {
        name == "@" ? domain : "\(name).\(domain)"
    }

    // MARK: - Edge

    private static func evaluateEdge(declared: DomainConfig, live: CloudflareZoneState) -> [Finding] {
        guard let edge = declared.edge else { return [] }
        var findings: [Finding] = []

        if edge.dnssec == true, !live.dnssecActive {
            findings.append(.init(
                category: .edge, title: "DNSSEC is not active",
                detail: "Declared but not applied on the live zone.",
                remediation: .autoApply(.hardenEdge(.enableDNSSEC))))
        }
        if edge.alwaysUseHTTPS == true, !live.alwaysUseHTTPS {
            findings.append(.init(
                category: .edge, title: "Always Use HTTPS is off",
                detail: "Declared but not applied on the live zone.",
                remediation: .autoApply(.hardenEdge(.enableAlwaysUseHTTPS))))
        }
        if let declaredHSTS = edge.hsts {
            let maxAge = declaredHSTS.maxAge ?? 31_536_000
            let includeSubdomains = declaredHSTS.includeSubdomains ?? true
            let preload = declaredHSTS.preload ?? false
            let matchesLive = live.hsts.map {
                $0.maxAge == maxAge && $0.includeSubdomains == includeSubdomains && $0.preload == preload
            } ?? false
            if !matchesLive {
                findings.append(.init(
                    category: .edge, title: "HSTS doesn't match the declared configuration",
                    detail: "Declared but not applied on the live zone.",
                    remediation: .autoApply(.hardenEdge(
                        .enableHSTS(maxAge: maxAge, includeSubdomains: includeSubdomains, preload: preload)))))
            }
        }
        if edge.cloudflare?.botFightMode == true, !live.botFightMode {
            findings.append(.init(
                category: .edge, title: "Bot Fight Mode is off",
                detail: "Declared but not applied on the live zone.",
                remediation: .autoApply(.hardenEdge(.enableBotFightMode))))
        }
        for rule in edge.cloudflare?.wafRules ?? [] {
            let isLive = live.wafCustomRules.contains {
                $0.description.caseInsensitiveCompare(rule.description) == .orderedSame
            }
            guard !isLive else { continue }
            findings.append(.init(
                category: .edge, title: "Declared WAF rule missing",
                detail: "\(rule.description) is declared but not live.",
                remediation: .autoApply(.hardenEdge(
                    .addWAFRule(description: rule.description, expression: rule.expression, action: rule.action)))))
        }

        return findings
    }
}
