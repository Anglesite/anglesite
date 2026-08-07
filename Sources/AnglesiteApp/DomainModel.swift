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
                case .bluesky: return DomainRecordPurpose.Verification.bluesky
                case .google: return DomainRecordPurpose.Verification.google
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

    /// One attempt to use the loaded domain as a Bluesky handle via the atproto HTTPS method
    /// (#1235) — separate from `phase` because it never touches a DNS record, unlike the existing
    /// `_atproto` TXT flow it falls back to.
    enum BlueskyHandlePhase: Equatable {
        case idle
        case verifying(domain: String)
        case verified(domain: String)
        case failed(domain: String, reason: String)
    }

    private(set) var phase: Phase = .idle
    private(set) var blueskyHandlePhase: BlueskyHandlePhase = .idle
    var sheetPresented: Bool = false
    var domainInput: String = ""
    /// Set by `openEmailSetup()`, read by `SiteWindow`'s domain-sheet `onDismiss` to sequence
    /// the Email Setup wizard's presentation after this sheet finishes dismissing — same
    /// handoff pattern as `ConnectDomainModel.pendingBuyDomain`.
    var pendingEmailSetup: Bool = false

    private let ops: any DomainOperationsService
    /// Injectable so tests can stub the `/.well-known/atproto-did` fetch without a network —
    /// mirrors `ops`'s own injection point. Production callers get `ATProtoDIDVerification`'s
    /// real, bounded-timeout transport.
    private let atprotoDIDTransport: POSSEHTTPTransport
    private var inFlight: Task<Void, Never>?

    private var currentSite: CurrentSite?

    init(
        ops: any DomainOperationsService = DomainOperations(),
        atprotoDIDTransport: @escaping POSSEHTTPTransport = ATProtoDIDVerification.defaultTransport
    ) {
        self.ops = ops
        self.atprotoDIDTransport = atprotoDIDTransport
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
        default: break
        }
        if case .verifying = blueskyHandlePhase { return true }
        return false
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .idle
        blueskyHandlePhase = .idle
        domainInput = ""
        sheetPresented = true
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
        phase = .idle
        blueskyHandlePhase = .idle
    }

    /// The "Set up Email…" affordance in the loaded record list (#769): closes this sheet and
    /// flags the handoff so `SiteWindow` opens the Email Setup wizard once dismissal finishes.
    func openEmailSetup() {
        pendingEmailSetup = true
        dismissSheet()
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

    /// "Use this domain as your Bluesky handle" (#1235) — the consequence-phrased, one-click
    /// alternative to hand-adding an `_atproto` TXT record. Prefers the atproto HTTPS method
    /// (`/.well-known/atproto-did`, no DNS record needed) whenever this exact domain is where the
    /// site is deployed and a Bluesky account is already connected (`ATPROTO_DID` persisted in
    /// `.site-config` — #1231); otherwise falls back to the existing TXT flow unchanged.
    func useAsBlueskyHandle() {
        guard case .loaded(_, let domain) = phase, !isRunning else { return }
        guard let site = currentSite, let did = Self.atprotoDID(sourceDirectory: site.sourceDirectory),
              Self.isDeployed(at: domain, sourceDirectory: site.sourceDirectory)
        else {
            beginAddRecord(context: .bluesky)
            return
        }
        blueskyHandlePhase = .verifying(domain: domain)
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runVerifyBlueskyHandle(domain: domain, did: did)
        }
    }

    /// Re-runs the well-known check from `.failed` without re-adding a DNS record — the site may
    /// simply not have redeployed yet since the DID was persisted.
    func retryBlueskyHandleVerification() {
        guard case .failed(let domain, _) = blueskyHandlePhase, !isRunning,
              let site = currentSite, let did = Self.atprotoDID(sourceDirectory: site.sourceDirectory)
        else { return }
        blueskyHandlePhase = .verifying(domain: domain)
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runVerifyBlueskyHandle(domain: domain, did: did)
        }
    }

    /// Dismisses the verified/failed banner without closing the whole sheet.
    func dismissBlueskyHandleResult() {
        blueskyHandlePhase = .idle
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

    /// Where changing a handle to a custom domain happens on Bluesky — opened (view-layer
    /// `NSWorkspace.shared.open`, matching `ConnectDomainModel.cloudflareDomainsURL`'s convention)
    /// once verification confirms the well-known endpoint is live.
    static let blueskyHandleChangeURL = URL(string: "https://bsky.app/settings/account")!

    // MARK: - Private

    /// The site's persisted `ATPROTO_DID` (#1231, `.site-config`), or `nil` when no Bluesky
    /// account is connected yet.
    private static func atprotoDID(sourceDirectory: URL) -> String? {
        guard let config = try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: sourceDirectory),
              let did = WebsiteAnalyticsAsset.configValue("ATPROTO_DID", in: config)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              !did.isEmpty
        else { return nil }
        return did
    }

    /// The scaffold's placeholder `SITE_URL` (#1235, mirroring the same gate the Standard.site
    /// publish pass uses) — a site still carrying it has never had a real deploy, so the
    /// well-known path can't possibly be live yet.
    private static let scaffoldDefaultSiteURL = "https://example.com"

    /// Whether `domain` is where this site is actually deployed — the one-click well-known path
    /// only works when the domain being managed in this sheet is the site's own live domain, not
    /// some unrelated zone the owner happens to also manage in Cloudflare.
    private static func isDeployed(at domain: String, sourceDirectory: URL) -> Bool {
        guard let siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: sourceDirectory),
              siteURL != scaffoldDefaultSiteURL,
              let host = URL(string: siteURL)?.host
        else { return false }
        return host.lowercased() == domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func runVerifyBlueskyHandle(domain: String, did: String) async {
        let outcome = await ATProtoDIDVerification.verify(domain: domain, expectedDID: did, transport: atprotoDIDTransport)
        // `dismissSheet()`/`openSheet()` cancel `inFlight` and reset `blueskyHandlePhase` to
        // `.idle` — without this guard, a verification that was already resuming from its
        // `await` when that happened would clobber that reset (or a subsequently reopened
        // sheet's fresh state) with a stale result the user never asked for in this session.
        guard !Task.isCancelled else { return }
        switch outcome {
        case .verified:
            blueskyHandlePhase = .verified(domain: domain)
        case .mismatch:
            // The endpoint IS live and serving DID-shaped content — just not this account's,
            // so "redeploy" would be misleading advice (e.g. someone else's atproto-did file,
            // or a stale marker a redeploy hasn't overwritten for an unrelated reason).
            blueskyHandlePhase = .failed(
                domain: domain,
                reason: "\(domain) already serves a different Bluesky DID at /.well-known/atproto-did. "
                    + "Make sure this domain is connected to the right Bluesky account, then try again."
            )
        case .unreachable:
            blueskyHandlePhase = .failed(
                domain: domain,
                reason: "Couldn't reach /.well-known/atproto-did on \(domain) yet. Redeploy your site, then try again."
            )
        }
    }

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
