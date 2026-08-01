import Foundation

/// Applies a `DomainConfigReconcilePlan` (unambiguous app-owned drift only — never contested
/// state) via the Cloudflare write API, then re-reads state and re-runs `DomainConfigAudit`. The
/// `DomainConfigAudit` counterpart to `HardenExecutor`, whose apply → re-read → re-audit shape it
/// reuses directly for `.hardenEdge` items (investigation doc §5.5: "remediation reuses the
/// Harden idiom"). Per-item failures do not abort the remaining items.
public struct DomainConfigReconciler: Sendable {
    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting

    /// Creates a reconciler. Reader and writer are separate seams, matching `HardenExecutor`.
    public init(reader: any CloudflareReading, writer: any CloudflareWriting) {
        self.reader = reader
        self.writer = writer
    }

    /// One plan item that failed to apply, paired with why — mirrors `HardenExecutor.ItemFailure`.
    public struct ItemFailure: Sendable {
        public let item: DomainConfigReconcileItem
        public let error: String
        public init(item: DomainConfigReconcileItem, error: String) {
            self.item = item
            self.error = error
        }
    }

    /// The outcome of one ``execute(plan:zoneID:domain:apiToken:declared:)`` run.
    public struct Result: Sendable {
        public let appliedCount: Int
        public let failedItems: [ItemFailure]
        /// Findings from re-auditing declared vs the fresh post-apply live state. Empty either
        /// means the audit is clean *or* the re-read failed — check ``auditError`` first.
        public let postAuditFindings: [DomainConfigAudit.Finding]
        public let auditError: String?

        public init(appliedCount: Int, failedItems: [ItemFailure],
                    postAuditFindings: [DomainConfigAudit.Finding], auditError: String? = nil) {
            self.appliedCount = appliedCount
            self.failedItems = failedItems
            self.postAuditFindings = postAuditFindings
            self.auditError = auditError
        }
    }

    /// Applies every item in `plan`, then re-reads the zone (state + DNS records) and re-audits
    /// `declared` against it so the caller shows the actual resulting drift, not an optimistic
    /// prediction. DNS items (`.createManagedRecord`/`.replaceManagedRecord`) apply directly
    /// against the writer; `.hardenEdge` items are batched into a `HardenPlan` and delegated to
    /// `HardenExecutor.execute`, so edge-setting application logic lives in exactly one place.
    public func execute(
        plan: DomainConfigReconcilePlan,
        zoneID: String,
        domain: String,
        apiToken: String,
        declared: DomainConfig
    ) async -> Result {
        var applied = 0
        var failures: [ItemFailure] = []
        var edgeItems: [HardenPlanItem] = []

        for item in plan.items {
            switch item {
            case .createManagedRecord(let record):
                do {
                    try await writer.addDNSRecord(zoneID: zoneID, record: payload(for: record), apiToken: apiToken)
                    applied += 1
                } catch {
                    failures.append(.init(item: item, error: "\(error)"))
                }
            case .replaceManagedRecord(let staleRecordID, let record):
                do {
                    try await writer.deleteDNSRecord(zoneID: zoneID, recordID: staleRecordID, apiToken: apiToken)
                    try await writer.addDNSRecord(zoneID: zoneID, record: payload(for: record), apiToken: apiToken)
                    applied += 1
                } catch {
                    failures.append(.init(item: item, error: "\(error)"))
                }
            case .hardenEdge(let hardenItem):
                edgeItems.append(hardenItem)
            }
        }

        if !edgeItems.isEmpty {
            let hardenResult = await HardenExecutor(reader: reader, writer: writer).execute(
                plan: HardenPlan(items: edgeItems), zoneID: zoneID, domain: domain, apiToken: apiToken)
            applied += hardenResult.appliedCount
            failures += hardenResult.failedItems.map {
                .init(item: .hardenEdge($0.item), error: $0.error)
            }
        }

        let findings: [DomainConfigAudit.Finding]
        var auditErr: String?
        do {
            let freshState = try await reader.zoneState(zoneID: zoneID, domain: domain, apiToken: apiToken)
            let freshRecords = try await reader.listDNSRecords(zoneID: zoneID, apiToken: apiToken)
            findings = DomainConfigAudit.evaluate(
                declared: declared, live: freshState, liveDNSRecords: freshRecords, domain: domain)
        } catch {
            findings = []
            auditErr = "\(error)"
        }

        return Result(appliedCount: applied, failedItems: failures,
                      postAuditFindings: findings, auditError: auditErr)
    }

    private func payload(for record: DomainConfig.DNSRecord) -> DNSRecordPayload {
        DNSRecordPayload(
            type: record.type, name: record.name, content: record.content,
            priority: record.priority, comment: record.purpose.map { "anglesite:\($0)" })
    }
}
