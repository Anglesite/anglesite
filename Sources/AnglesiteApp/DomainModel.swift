import SwiftUI
import AnglesiteCore

@MainActor
@Observable
final class DomainModel {
    struct Draft: Equatable {
        enum Context: Equatable {
            case generic, bluesky, google

            /// The `dns.managedRecords` purpose tag for a record added in this context — `nil`
            /// for `.generic` (an owner-typed record with no specific reason the app can name),
            /// matching the schema's "purpose is optional" contract (#1170).
            var purpose: String? {
                switch self {
                case .generic: return nil
                case .bluesky: return "verification:bluesky"
                case .google: return "verification:google"
                }
            }
        }
        var type: String
        var name: String
        var content: String
        var ttl: Int
        /// Mail server priority (lower = preferred) — only meaningful for MX records.
        var priority: Int?
        var context: Context

        static func empty(context: Context = .generic) -> Draft {
            switch context {
            case .bluesky:
                return Draft(type: "TXT", name: "_atproto", content: "", ttl: 1, priority: nil, context: .bluesky)
            case .generic, .google:
                return Draft(type: "TXT", name: "", content: "", ttl: 1, priority: nil, context: context)
            }
        }
    }

    enum Phase: Equatable {
        case idle
        case resolvingZone(domain: String)
        case loaded(records: [DNSRecord], domain: String)
        case addingRecord(draft: Draft, records: [DNSRecord], domain: String)
        case confirmingDelete(record: DNSRecord, records: [DNSRecord], domain: String)
        case applying(domain: String)
        case failed(reason: String)
    }

    private(set) var phase: Phase = .idle
    var sheetPresented: Bool = false
    var domainInput: String = ""

    private let ops: any DomainOperationsService
    private var inFlight: Task<Void, Never>?

    private var currentSite: CurrentSite?

    init(ops: any DomainOperationsService = DomainOperations()) {
        self.ops = ops
    }

    /// Threaded from `SiteWindowModel.loadAndStart` (#822 pattern) so add/delete can write
    /// through to `Source/anglesite.json` (#1170). Not passed to `init` because `harden`/`domain`
    /// are constructed before the site resolves (`SiteWindowModel`'s `var domain = DomainModel()`).
    func configure(site: CurrentSite) {
        currentSite = site
    }

    var isRunning: Bool {
        switch phase {
        case .resolvingZone, .applying: return true
        default: return false
        }
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .idle
        domainInput = ""
        sheetPresented = true
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
        phase = .idle
    }

    /// Like `openSheet()` but preserves `domainInput` — matches `HardenModel.retryFromFailed()`,
    /// so a failed lookup doesn't force the user to retype the domain.
    func retryFromFailed() {
        guard !isRunning else { return }
        phase = .idle
        sheetPresented = true
    }

    func resolveAndLoad() {
        let domain = domainInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !domain.isEmpty, !isRunning else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runLoad(domain: domain)
        }
    }

    func refresh() {
        guard case .loaded(_, let domain) = phase, !isRunning else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runLoad(domain: domain)
        }
    }

    func beginAddRecord(context: Draft.Context = .generic) {
        guard case .loaded(let records, let domain) = phase else { return }
        phase = .addingRecord(draft: .empty(context: context), records: records, domain: domain)
    }

    func updateDraft(_ draft: Draft) {
        guard case .addingRecord(_, let records, let domain) = phase else { return }
        phase = .addingRecord(draft: draft, records: records, domain: domain)
    }

    func cancelAddRecord() {
        guard case .addingRecord(_, let records, let domain) = phase else { return }
        phase = .loaded(records: records, domain: domain)
    }

    func submitAddRecord() {
        guard case .addingRecord(let draft, _, let domain) = phase, !isRunning else { return }
        guard !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !draft.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runAdd(draft: draft, domain: domain)
        }
    }

    func beginDelete(_ record: DNSRecord) {
        guard case .loaded(let records, let domain) = phase else { return }
        phase = .confirmingDelete(record: record, records: records, domain: domain)
    }

    func cancelDelete() {
        guard case .confirmingDelete(_, let records, let domain) = phase else { return }
        phase = .loaded(records: records, domain: domain)
    }

    func confirmDelete() {
        guard case .confirmingDelete(let record, _, let domain) = phase, !isRunning else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runDelete(record: record, domain: domain)
        }
    }

    // MARK: - Private

    private func runLoad(domain: String) async {
        phase = .resolvingZone(domain: domain)
        switch await ops.listRecords(domain: domain) {
        case .success(let records):
            phase = .loaded(records: records, domain: domain)
        case .failure(let error):
            phase = .failed(reason: message(for: error, domain: domain))
        }
    }

    private func runAdd(draft: Draft, domain: String) async {
        phase = .applying(domain: domain)
        let result = await ops.addRecord(
            domain: domain, type: draft.type, name: draft.name, content: draft.content,
            ttl: draft.ttl, priority: draft.priority, purpose: draft.context.purpose,
            sourceDirectory: currentSite?.sourceDirectory)
        switch result {
        case .success:
            await runLoad(domain: domain)
        case .failure(let error):
            phase = .failed(reason: message(for: error, domain: domain))
        }
    }

    private func runDelete(record: DNSRecord, domain: String) async {
        phase = .applying(domain: domain)
        switch await ops.deleteRecord(
            domain: domain, recordID: record.id, type: record.type, name: record.name,
            content: record.content, sourceDirectory: currentSite?.sourceDirectory
        ) {
        case .success:
            await runLoad(domain: domain)
        case .failure(let error):
            phase = .failed(reason: message(for: error, domain: domain))
        }
    }

    private func message(for error: DomainOperationError, domain: String) -> String {
        switch error {
        case .noToken:
            return "No Cloudflare API token found. Add one in Settings → Credentials."
        case .zoneNotFound(let d):
            return "Zone not found for \"\(d)\". Check the domain and ensure your API token has Zone Read permission."
        case .cloudflare(let cfError):
            switch cfError {
            case .unauthorized:
                return "API token is unauthorized. Check that it has Zone Read and DNS Edit permissions."
            case .http(let status):
                return "Cloudflare API returned HTTP \(status)."
            case .api(let msg):
                return "Cloudflare API error: \(msg)"
            case .malformedResponse:
                return "Unexpected response from Cloudflare API."
            }
        }
    }
}
