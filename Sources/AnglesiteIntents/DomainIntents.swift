import AppIntents
import AnglesiteCore
import Foundation

// MARK: - Dialog formatting (pure, unit-testable)

/// Pure dialog strings for the three DNS intents. No AppIntents types, so these are fully
/// unit-testable without the AppIntents runtime — same split as ``ContentDialogs`` and
/// ``IntegrationDialogs``.
public enum DomainDialogs {
    /// One line per record, each prefixed with `DNSRecordLabeler`'s purpose label (e.g.
    /// "Mail routing") so a non-technical owner hears what a record is *for*, not just its
    /// raw type/name/content triple.
    public static func recordsSummary(_ records: [DNSRecord], domain: String) -> String {
        if records.isEmpty { return "\(domain) has no DNS records." }
        let lines = records.map { record in
            "\(DNSRecordLabeler.label(for: record)): \(record.type) \(record.name) → \(record.content)"
        }
        return "\(domain) has \(records.count) DNS record\(records.count == 1 ? "" : "s"):\n" + lines.joined(separator: "\n")
    }
    /// Success dialog for ``AddDNSRecordIntent``. Echoes type/name/domain back so the user can
    /// catch a mis-heard parameter even after confirming.
    public static func added(type: String, name: String, domain: String) -> String {
        "Added a \(type) record for \(name) on \(domain)."
    }
    /// Success dialog for ``DeleteDNSRecordIntent``.
    public static func deleted(domain: String) -> String {
        "Deleted the DNS record from \(domain)."
    }
    /// Failure dialog shared by all three DNS intents; `reason` is the human-readable rendering
    /// of a `DomainOperationError`.
    public static func failed(reason: String, domain: String) -> String {
        "Couldn't finish that on \(domain): \(reason)."
    }
}

private func domainErrorMessage(_ error: DomainOperationError, domain: String) -> String {
    switch error {
    case .noToken:
        return "No Cloudflare API token found."
    case .zoneNotFound(let d):
        return "Zone not found for \"\(d)\"."
    case .cloudflare(let cfError):
        switch cfError {
        case .unauthorized: return "API token is unauthorized."
        case .http(let status): return "Cloudflare API returned HTTP \(status)."
        case .api(let message): return "Cloudflare API error: \(message)"
        case .malformedResponse: return "Unexpected response from Cloudflare API."
        }
    }
}

// MARK: - List DNS Records

/// Read-only Siri/Shortcuts entry point for a domain's DNS records, backed by
/// `DomainOperationsService` (Cloudflare under the hood). The only DNS intent with no
/// confirmation gate — listing mutates nothing.
public struct ListDNSRecordsIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation.
    public static let title: LocalizedStringResource = "List DNS Records"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription("List the current DNS records for a domain.")

    /// The zone to list, as a bare domain name (e.g. `example.com`); the service resolves it
    /// to a Cloudflare zone and reports `zoneNotFound` when it doesn't exist on the account.
    @Parameter(title: "Domain") public var domain: String
    @Dependency private var ops: any DomainOperationsService

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "List DNS records for (domain)".
    public static var parameterSummary: some ParameterSummary {
        Summary("List DNS records for \(\.$domain)")
    }

    /// Lists the records and speaks a purpose-labeled summary. Resolves the service through
    /// ``DomainOperationsOverride`` first so tests can inject a fake without the `@Dependency`
    /// container.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let svc = DomainOperationsOverride.scoped ?? ops
        let dialog = await run(svc: svc)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }

    private func run(svc: any DomainOperationsService) async -> String {
        switch await svc.listRecords(domain: domain) {
        case .success(let records):
            return DomainDialogs.recordsSummary(records, domain: domain)
        case .failure(let error):
            return DomainDialogs.failed(reason: domainErrorMessage(error, domain: domain), domain: domain)
        }
    }
}

// MARK: - Add DNS Record

/// Siri/Shortcuts entry point for creating a DNS record. Mutating, so `perform()` requires an
/// explicit user confirmation before touching the zone — the app advises but never silently
/// rewrites an owner's DNS.
public struct AddDNSRecordIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation.
    public static let title: LocalizedStringResource = "Add DNS Record"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription(
        "Add a DNS record (TXT, CNAME, A, AAAA, or MX) to a domain."
    )

    /// The zone to add to, as a bare domain name (e.g. `example.com`).
    @Parameter(title: "Domain") public var domain: String
    /// Record type, as the uppercase DNS mnemonic (TXT, CNAME, A, AAAA, or MX). A free string
    /// rather than an `AppEnum` so the service — not the Siri surface — owns which types are
    /// accepted.
    @Parameter(title: "Type", description: "TXT, CNAME, A, AAAA, or MX.") public var type: String
    /// Record name (host), e.g. `www` or `@`.
    @Parameter(title: "Name") public var name: String
    /// Record content/value — the target hostname, IP address, or TXT payload depending on `type`.
    @Parameter(title: "Content") public var content: String
    /// Time-to-live in seconds. Defaults to `1`, which Cloudflare interprets as "automatic" —
    /// the right answer for owners who never think about TTLs.
    @Parameter(title: "TTL", default: 1) public var ttl: Int
    /// MX preference value; ignored for other record types. Optional so non-mail records don't
    /// prompt for it.
    @Parameter(title: "Priority", description: "Required for MX records — lower is a more preferred mail server.")
    public var priority: Int?
    @Dependency private var ops: any DomainOperationsService

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "Add a (type) record to (domain)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Add a \(\.$type) record to \(\.$domain)")
    }

    /// Confirms with the user, then adds the record and reports the outcome as dialog. The
    /// confirmation is skipped when ``DomainOperationsOverride`` is bound — `requestConfirmation`
    /// needs the live Siri/Shortcuts runtime, which unit tests don't have.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let svc = DomainOperationsOverride.scoped ?? ops
        if DomainOperationsOverride.scoped == nil {
            try await requestConfirmation(dialog: "Add a \(type) record for \(name) to \(domain)?")
        }
        let dialog = await run(svc: svc)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }

    private func run(svc: any DomainOperationsService) async -> String {
        switch await svc.addRecord(domain: domain, type: type, name: name, content: content, ttl: ttl, priority: priority) {
        case .success:
            return DomainDialogs.added(type: type, name: name, domain: domain)
        case .failure(let error):
            return DomainDialogs.failed(reason: domainErrorMessage(error, domain: domain), domain: domain)
        }
    }
}

// MARK: - Delete DNS Record

/// Siri/Shortcuts entry point for removing a DNS record. Addresses the record by opaque
/// provider ID rather than type/name matching, so a delete can never fuzzy-match the wrong
/// record — the destructive intent gets the most precise addressing.
public struct DeleteDNSRecordIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation.
    public static let title: LocalizedStringResource = "Delete DNS Record"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription(
        "Delete a DNS record from a domain by its record identifier."
    )

    /// The zone to delete from, as a bare domain name (e.g. `example.com`).
    @Parameter(title: "Domain") public var domain: String
    /// The provider-side record identifier, as surfaced by a prior ``ListDNSRecordsIntent``
    /// run — deletion is ID-addressed, never name-matched.
    @Parameter(title: "Record ID", description: "From a prior List DNS Records call.") public var recordID: String
    @Dependency private var ops: any DomainOperationsService

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "Delete a DNS record from (domain)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Delete a DNS record from \(\.$domain)")
    }

    /// Confirms with the user (wording flags irreversibility), then deletes and reports the
    /// outcome as dialog. The confirmation is skipped when ``DomainOperationsOverride`` is
    /// bound — `requestConfirmation` needs the live Siri/Shortcuts runtime, which unit tests
    /// don't have.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let svc = DomainOperationsOverride.scoped ?? ops
        if DomainOperationsOverride.scoped == nil {
            try await requestConfirmation(dialog: "Delete this DNS record from \(domain)? This can't be undone.")
        }
        let dialog = await run(svc: svc)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }

    private func run(svc: any DomainOperationsService) async -> String {
        switch await svc.deleteRecord(domain: domain, recordID: recordID) {
        case .success:
            return DomainDialogs.deleted(domain: domain)
        case .failure(let error):
            return DomainDialogs.failed(reason: domainErrorMessage(error, domain: domain), domain: domain)
        }
    }
}

// MARK: - Test-only helpers

extension ListDNSRecordsIntent {
    /// Drives `perform`'s dialog logic directly, bypassing the AppIntents `@Dependency` gate.
    /// Only callable when `DomainOperationsOverride.scoped` is bound.
    func performForTesting() async -> String {
        guard let svc = DomainOperationsOverride.scoped else {
            fatalError("performForTesting requires a bound DomainOperationsOverride.scoped")
        }
        return await run(svc: svc)
    }
}

extension AddDNSRecordIntent {
    /// Drives the add directly, bypassing the AppIntents `requestConfirmation` gate.
    /// Only callable when `DomainOperationsOverride.scoped` is bound.
    func applyForTesting() async -> String {
        guard let svc = DomainOperationsOverride.scoped else {
            fatalError("applyForTesting requires a bound DomainOperationsOverride.scoped")
        }
        return await run(svc: svc)
    }
}

extension DeleteDNSRecordIntent {
    /// Drives the delete directly, bypassing the AppIntents `requestConfirmation` gate.
    /// Only callable when `DomainOperationsOverride.scoped` is bound.
    func applyForTesting() async -> String {
        guard let svc = DomainOperationsOverride.scoped else {
            fatalError("applyForTesting requires a bound DomainOperationsOverride.scoped")
        }
        return await run(svc: svc)
    }
}
