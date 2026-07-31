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

    /// The outcome of one ``HardenExecutor/execute(plan:zoneID:domain:apiToken:)`` run. Always returned, never
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
    /// re-flagged for missing mail hardening.
    public func execute(
        plan: HardenPlan,
        zoneID: String,
        domain: String,
        apiToken: String
    ) async -> Result {
        var applied = 0
        var failures: [ItemFailure] = []

        for item in plan.items {
            do {
                try await apply(item, zoneID: zoneID, domain: domain, apiToken: apiToken)
                applied += 1
            } catch {
                failures.append(.init(item: item, error: "\(error)"))
            }
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
                                         content: "0 issue \"\(ca)\""),
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
                record: DNSRecordPayload(type: "MX", name: domain, content: ".", priority: 0),
                apiToken: apiToken)
        case .addSPFRejectAll:
            try await writer.addDNSRecord(
                zoneID: zoneID,
                record: DNSRecordPayload(type: "TXT", name: domain, content: "v=spf1 -all"),
                apiToken: apiToken)
        case .addDMARCReject:
            try await writer.addDNSRecord(
                zoneID: zoneID,
                record: DNSRecordPayload(type: "TXT", name: "_dmarc.\(domain)",
                                         content: "v=DMARC1; p=reject"),
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
}
