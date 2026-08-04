import Foundation

/// Applies a `HardenPlan` via the Cloudflare write API, then re-reads state and re-audits.
/// Per-item failures do not abort the remaining items.
public struct HardenExecutor: Sendable {
    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting

    /// Creates an executor. Reader and writer are separate seams (the
    /// `CloudflareReading`/`CloudflareWriting` split) so tests can fake writes while still
    /// exercising the post-apply re-read/re-audit path.
    public init(reader: any CloudflareReading, writer: any CloudflareWriting) {
        self.reader = reader
        self.writer = writer
    }

    /// One plan item that failed to apply, paired with why. The error is captured as a display
    /// string (`"\(error)"`) because the underlying error types are heterogeneous API failures the
    /// caller can only show, not handle.
    public struct ItemFailure: Sendable {
        /// The plan item that failed.
        public let item: HardenPlanItem
        /// The stringified underlying error, for display.
        public let error: String
        /// Creates a failure record.
        public init(item: HardenPlanItem, error: String) {
            self.item = item
            self.error = error
        }
    }

    /// The outcome of one ``HardenExecutor/execute(plan:zoneID:domain:apiToken:sourceDirectory:)`` run. Always returned, never
    /// thrown — partial success is the expected shape, so errors are folded in per item.
    public struct Result: Sendable {
        /// How many plan items applied successfully.
        public let appliedCount: Int
        /// The items that failed, each with its error. Empty means the whole plan applied.
        public let failedItems: [ItemFailure]
        /// Findings from re-auditing the zone's fresh post-apply state. Empty either means the
        /// zone audits clean *or* the re-read failed — check ``auditError`` before treating an
        /// empty list as clean.
        public let postAuditFindings: [AuditReport.Finding]
        /// Set when the post-apply re-read/re-audit itself failed (in which case
        /// ``postAuditFindings`` is empty and says nothing about the zone).
        public let auditError: String?

        /// Creates a result.
        public init(appliedCount: Int, failedItems: [ItemFailure],
                    postAuditFindings: [AuditReport.Finding], auditError: String? = nil) {
            self.appliedCount = appliedCount
            self.failedItems = failedItems
            self.postAuditFindings = postAuditFindings
            self.auditError = auditError
        }
    }

    /// Applies every item in `plan`, then re-reads the zone and re-audits it so the caller can
    /// show the actual resulting state rather than an optimistic prediction.
    ///
    /// Items are applied independently — one failure doesn't abort the rest, it's recorded in
    /// ``Result/failedItems``. The re-audit derives `expectsMail` from the *fresh* MX records
    /// (treating only a null MX as "no mail"), so a plan that just added a null MX doesn't get
    /// re-flagged for missing mail hardening. When `sourceDirectory` is non-nil, the
    /// successfully-applied items are also write-through-serialized into `Source/anglesite.json`'s
    /// `edge` section (#1170) — see this type's private `writeThroughEdge(_:sourceDirectory:)`.
    public func execute(
        plan: HardenPlan,
        zoneID: String,
        domain: String,
        apiToken: String,
        sourceDirectory: URL? = nil
    ) async -> Result {
        var applied = 0
        var appliedItems: [HardenPlanItem] = []
        var failures: [ItemFailure] = []

        for item in plan.items {
            do {
                try await apply(item, zoneID: zoneID, domain: domain, apiToken: apiToken)
                applied += 1
                appliedItems.append(item)
            } catch {
                failures.append(.init(item: item, error: "\(error)"))
            }
        }

        if let sourceDirectory {
            Self.writeThroughEdge(appliedItems, sourceDirectory: sourceDirectory)
        }

        let findings: [AuditReport.Finding]
        var auditErr: String?
        do {
            let freshState = try await reader.zoneState(zoneID: zoneID, domain: domain, apiToken: apiToken)
            let expectsMail = !freshState.mxRecords.isEmpty
                && !freshState.mxRecords.allSatisfy({ $0.trimmingCharacters(in: .whitespaces) == "." || $0.hasPrefix("0 .") })
            findings = SecurityAudit.evaluate(freshState, expectsMail: expectsMail)
        } catch {
            findings = []
            auditErr = "\(error)"
        }

        return Result(appliedCount: applied, failedItems: failures,
                      postAuditFindings: findings, auditError: auditErr)
    }

    private func apply(_ item: HardenPlanItem, zoneID: String, domain: String,
                        apiToken: String) async throws {
        switch item {
        case .enableDNSSEC:
            try await writer.enableDNSSEC(zoneID: zoneID, apiToken: apiToken)
        case .addCAARecord(let ca):
            try await writer.addDNSRecord(
                zoneID: zoneID,
                record: DNSRecordPayload(type: "CAA", name: domain,
                                         content: "0 issue \"\(ca)\"",
                                         comment: "anglesite:\(DomainRecordPurpose.Security.caa)"),
                apiToken: apiToken)
        case .enableAlwaysUseHTTPS:
            try await writer.setAlwaysUseHTTPS(zoneID: zoneID, enabled: true, apiToken: apiToken)
        case .enableHSTS(let maxAge, let subs, let preload):
            try await writer.setHSTS(zoneID: zoneID, maxAge: maxAge, includeSubdomains: subs,
                                     preload: preload, apiToken: apiToken)
        case .enableBotFightMode:
            try await writer.setBotFightMode(zoneID: zoneID, enabled: true, apiToken: apiToken)
        case .addNullMX:
            try await writer.addDNSRecord(
                zoneID: zoneID,
                record: DNSRecordPayload(type: "MX", name: domain, content: ".", priority: 0,
                                         comment: "anglesite:\(DomainRecordPurpose.Security.nullMX)"),
                apiToken: apiToken)
        case .addSPFRejectAll:
            try await writer.addDNSRecord(
                zoneID: zoneID,
                record: DNSRecordPayload(type: "TXT", name: domain, content: "v=spf1 -all",
                                         comment: "anglesite:\(DomainRecordPurpose.Security.spfReject)"),
                apiToken: apiToken)
        case .addDMARCReject:
            try await writer.addDNSRecord(
                zoneID: zoneID,
                record: DNSRecordPayload(type: "TXT", name: "_dmarc.\(domain)",
                                         content: "v=DMARC1; p=reject",
                                         comment: "anglesite:\(DomainRecordPurpose.Security.dmarcReject)"),
                apiToken: apiToken)
        case .addWAFRule(let desc, let expr, let action):
            try await writer.createWAFCustomRule(
                zoneID: zoneID,
                rule: WAFRulePayload(description: desc, expression: expr, action: action),
                apiToken: apiToken)
        case .enableSpeedBrain:
            try await writer.setSpeedBrain(zoneID: zoneID, enabled: true, apiToken: apiToken)
        case .enableZstandardCompression:
            try await writer.enableZstandardCompression(zoneID: zoneID, apiToken: apiToken)
        case .enableECH:
            try await writer.setECH(zoneID: zoneID, enabled: true, apiToken: apiToken)
        case .enablePageShieldMonitoring:
            try await writer.setPageShield(zoneID: zoneID, enabled: true, apiToken: apiToken)
        }
    }

    /// Serializes exactly the successfully-applied items into `anglesite.json`'s `edge` section
    /// (#1170; the owner decision behind "exactly," not an aspirational target, is investigation
    /// doc §7.2). Best-effort — see `DomainOperations`'s identical write-through posture. DNS-record
    /// hardening items (`.addCAARecord`/`.addNullMX`/`.addSPFRejectAll`/`.addDMARCReject`) are
    /// intentionally not mirrored into `dns.managedRecords` here — this slice ties that array to
    /// `DomainOperations` specifically (see this file's own PR/issue for the scope note); tracking
    /// Harden's own DNS writes is left to a follow-up.
    private static func writeThroughEdge(_ items: [HardenPlanItem], sourceDirectory: URL) {
        guard !items.isEmpty else { return }
        DomainConfigStore.update(sourceDirectory: sourceDirectory) { config in
            var edge = config.edge ?? DomainConfig.Edge()
            var cloudflareEdge = edge.cloudflare ?? DomainConfig.Edge.CloudflareEdge()
            var newWAFRules: [DomainConfig.Edge.WAFRule] = []

            for item in items {
                switch item {
                case .enableDNSSEC:
                    edge.dnssec = true
                case .enableAlwaysUseHTTPS:
                    edge.alwaysUseHTTPS = true
                case .enableHSTS(let maxAge, let subs, let preload):
                    edge.hsts = .init(maxAge: maxAge, includeSubdomains: subs, preload: preload)
                case .enableBotFightMode:
                    cloudflareEdge.botFightMode = true
                case .addWAFRule(let desc, let expr, let action):
                    newWAFRules.append(.init(description: desc, expression: expr, action: action))
                case .addCAARecord, .addNullMX, .addSPFRejectAll, .addDMARCReject,
                     .enableSpeedBrain, .enableZstandardCompression, .enableECH, .enablePageShieldMonitoring:
                    break
                }
            }

            if !newWAFRules.isEmpty {
                cloudflareEdge.wafRules = DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules(
                    newWAFRules, onto: cloudflareEdge.wafRules ?? [])
            }
            if cloudflareEdge.botFightMode != nil || cloudflareEdge.wafRules != nil {
                edge.cloudflare = cloudflareEdge
            }
            config.edge = edge
        }
    }
}
