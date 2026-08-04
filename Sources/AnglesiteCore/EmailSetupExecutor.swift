import Foundation

/// Applies an `EmailSetupPlanner.DNSPlan` — the first `Source/anglesite.json` `email` producer
/// (#1170; the planner itself has no GUI front door yet, tracked separately by #769). Adds every
/// record in the plan through `DomainOperationsService`, tagging each with a
/// `"email:<provider>"` purpose (so the live Cloudflare record gets the matching `comment`, and
/// `dns.managedRecords` gets the entry), then declares the provider choice itself.
public struct EmailSetupExecutor: Sendable {
    private let ops: any DomainOperationsService

    /// `ops` is the same seam `DomainModel`/`DomainIntents` use — production callers should pass
    /// the live `DomainOperations()`.
    public init(ops: any DomainOperationsService) {
        self.ops = ops
    }

    /// One record from the plan that failed to add, paired with why.
    public struct RecordFailure: Sendable {
        public let record: EmailSetupPlanner.RecordTemplate
        public let error: DomainOperationError
        public init(record: EmailSetupPlanner.RecordTemplate, error: DomainOperationError) {
            self.record = record
            self.error = error
        }
    }

    /// The outcome of one ``apply(plan:domain:dmarcReportEmail:sourceDirectory:)`` run. Always
    /// returned, never thrown — a per-record Cloudflare failure doesn't abort the rest, mirroring
    /// `HardenExecutor.Result`.
    public struct Result: Sendable {
        public let addedCount: Int
        public let failures: [RecordFailure]
        public init(addedCount: Int, failures: [RecordFailure]) {
            self.addedCount = addedCount
            self.failures = failures
        }
    }

    /// Adds every record in `plan.records`, each tagged `"email:<provider.rawValue>"`, then
    /// declares `email.provider`/`email.dmarcReportEmail` in `Source/anglesite.json` when
    /// `sourceDirectory` is non-nil — written unconditionally (even if every record add failed):
    /// the provider/report-address choice is the owner's declared intent, independent of whether
    /// this particular apply run's DNS writes all landed (mirrors `domain.attach` being intent,
    /// not confirmation — investigation doc §5.2).
    ///
    /// Folding each added record into `dns.managedRecords` is `ops.addRecord`'s own documented
    /// responsibility (see `DomainOperationsService.addRecord`'s doc comment), not this type's —
    /// this executor only declares the `email` section itself.
    public func apply(
        plan: EmailSetupPlanner.DNSPlan, domain: String, dmarcReportEmail: String, sourceDirectory: URL?
    ) async -> Result {
        var added = 0
        var failures: [RecordFailure] = []
        let purpose = DomainRecordPurpose.Email.provider(plan.provider)

        for record in plan.records {
            let result = await ops.addRecord(
                domain: domain, type: record.type, name: record.name, content: record.content,
                ttl: 1, priority: record.priority, purpose: purpose, sourceDirectory: sourceDirectory)
            switch result {
            case .success:
                added += 1
            case .failure(let error):
                failures.append(.init(record: record, error: error))
            }
        }

        if let sourceDirectory {
            DomainConfigStore.update(sourceDirectory: sourceDirectory) { config in
                config.email = DomainConfig.Email(provider: plan.provider.rawValue, dmarcReportEmail: dmarcReportEmail)
            }
        }

        return Result(addedCount: added, failures: failures)
    }
}
