import Foundation

/// Best-effort post-deploy pass that publishes `site.standard.publication`/`site.standard.document`
/// records to the Atmosphere (#1231) — see `docs/superpowers/specs/2026-08-04-atproto-standard-site-design.md`.
/// Modeled on ``POSSESyndicationCommand``: never throws into the deploy result, ledgers in
/// `Config/`, logs to the debug pane under a `standardsite:` source.
///
/// Reuses the site's Bluesky POSSE credential — zero new onboarding. No credential, or no real
/// deployed `SITE_URL` yet, and the pass silently no-ops, matching how the POSSE pass skips
/// unconfigured platforms.
///
/// Because rkeys are deterministic (``POSSEStableKey``) and writes go through
/// ``AtprotoPutRecordClient/put(collection:rkey:record:credentials:transport:)`` (create-or-update),
/// there is no ledger-gated skip: every
/// eligible post's record is re-put on every run, so a content edit's next deploy always converges
/// the record to match — "Updates are free" per the design doc. The ledger exists for debug-pane
/// history and a future unpublish pass (v1.1), not as a dedup gate.
public actor StandardSitePublishCommand {
    private struct InFlight {
        let id: UUID
        let task: Task<Void, Never>
    }

    /// `.site-config` key the session DID is persisted under after the first successful publish
    /// — needed by increment 2's build-time well-known/link-tag emission.
    static let didConfigKey = "ATPROTO_DID"
    /// Optional `.site-config` escape hatch for a site description; nothing writes it yet (no
    /// Settings field exists for it), but the app already treats `.site-config` as hand-editable
    /// (git is the source of truth), so an owner can set it today and have it picked up here.
    static let descriptionConfigKey = "SITE_DESCRIPTION"

    private let credentials: POSSECredentialResolver.Provider
    private let transport: POSSEHTTPTransport
    private let logCenter: LogCenter
    private let now: @Sendable () -> Date
    private var inFlight: [String: InFlight] = [:]

    var activeSiteCount: Int { inFlight.count }

    /// Creates the command actor. Every dependency is injectable — credentials, HTTP transport,
    /// log sink, and clock — so tests can drive a full publish pass with no network, secret
    /// store, or real time; the defaults wire up production behavior.
    public init(
        credentials: @escaping POSSECredentialResolver.Provider = POSSECredentialResolver.provider(),
        transport: @escaping POSSEHTTPTransport = POSSESyndicationCommand.defaultTransport,
        logCenter: LogCenter = .shared,
        now: @escaping @Sendable () -> Date = { Date.now }
    ) {
        self.credentials = credentials
        self.transport = transport
        self.logCenter = logCenter
        self.now = now
    }

    /// Runs one post-deploy Standard.site publish pass for a site. Runs per site are serialized (a
    /// newer call chains behind the in-flight one) so two overlapping deploys can't race the
    /// ledger or `.site-config`; distinct sites proceed concurrently.
    ///
    /// Never throws: every per-entry failure is logged and skipped, and the pass as a whole no-ops
    /// when the site has no Bluesky credential or no real deployed `SITE_URL` yet.
    public func publish(siteID: String, siteDirectory: URL, configDirectory: URL) async {
        let previous = inFlight[siteID]?.task
        let id = UUID()
        let task = Task<Void, Never> { [weak self] in
            _ = await previous?.value
            await self?.perform(siteID: siteID, siteDirectory: siteDirectory, configDirectory: configDirectory)
        }
        inFlight[siteID] = InFlight(id: id, task: task)
        await task.value
        if inFlight[siteID]?.id == id {
            inFlight[siteID] = nil
        }
    }

    private func perform(siteID: String, siteDirectory: URL, configDirectory: URL) async {
        let source = "standardsite:\(siteID)"
        guard let bluesky = credentials(siteID, configDirectory).bluesky else { return }
        guard let siteURLString = DeployCoordinator.resolveSiteURL(siteDirectory: siteDirectory),
              siteURLString != "https://example.com",
              let siteURL = URL(string: siteURLString) else { return }

        // Unlike the two gates above (not yet configured — nothing for the owner to act on),
        // this one is a deliberate choice made in Site Settings (#1233), so skipping it is
        // logged rather than silent: "logs are sacred, no silent drops."
        let settings = (try? SiteConfigStore.read(from: configDirectory)) ?? SiteSettings()
        guard settings.publishToAtmosphere ?? true else {
            await logCenter.append(
                source: source, stream: .stdout,
                text: "standardsite: skipped — \"Publish posts to the Atmosphere\" is off in Site Settings"
            )
            return
        }

        let plan = StandardSiteDocumentPlan.build(projectRoot: siteDirectory, referenceDate: now())

        var ledger = StandardSitePublishLog.load(from: configDirectory) ?? StandardSitePublishLog()
        let config = (try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: siteDirectory)) ?? ""
        let siteName = SiteConfigValues.siteName(sourceDirectory: siteDirectory) ?? siteID
        let description = nonBlank(SiteConfigFile.value(forKey: Self.descriptionConfigKey, in: config))

        let publication = StandardSitePublicationRecord(name: siteName, url: siteURL.absoluteString, description: description)
        let publicationRkey = "anglesite-\(POSSEStableKey.make(siteID))"

        // One login for the whole run: every record write below reuses this session instead of
        // creating a fresh one per `putRecord` call, which would otherwise be N+1 separate
        // app-password logins against the PDS for N posts in a single deploy.
        let session: AtprotoPutRecordClient.Session
        do {
            session = try await AtprotoPutRecordClient.createSession(credentials: bluesky, transport: transport)
        } catch {
            await logError("couldn't sign in to publish: \(error.localizedDescription)", source: source)
            return
        }

        let publicationResult: AtprotoPutRecordClient.Result
        do {
            publicationResult = try await AtprotoPutRecordClient.putRecord(
                collection: "site.standard.publication", rkey: publicationRkey, record: publication,
                pdsURL: bluesky.pdsURL, session: session, transport: transport
            )
        } catch {
            await logError("couldn't publish site.standard.publication: \(error.localizedDescription)", source: source)
            return
        }
        persistDID(publicationResult.did, siteDirectory: siteDirectory)
        ledger.publicationURI = publicationResult.uri
        try? ledger.save(to: configDirectory)

        // Debug-pane visibility into the pass as a whole (#1233), not just each record — "logs
        // are sacred, no silent drops" extends to the shape of a successful run, not only its
        // failures.
        var publishedCount = 0
        var updatedCount = 0
        var failedCount = 0

        for entry in plan.entries {
            let wasAlreadyPublished = ledger.entries.contains { $0.path == entry.path }
            let documentRkey = "anglesite-\(POSSEStableKey.make("\(siteID)\n\(entry.path)"))"
            let document = StandardSiteDocumentRecord(
                site: publicationResult.uri,
                title: entry.title,
                description: entry.description,
                path: entry.path,
                publishedAt: iso8601(entry.publishedAt),
                updatedAt: entry.updatedAt.map(iso8601),
                tags: entry.tags,
                textContent: entry.textContent
            )
            let documentResult: AtprotoPutRecordClient.Result
            do {
                documentResult = try await AtprotoPutRecordClient.putRecord(
                    collection: "site.standard.document", rkey: documentRkey, record: document,
                    pdsURL: bluesky.pdsURL, session: session, transport: transport
                )
            } catch {
                failedCount += 1
                await logError("couldn't publish \(entry.path): \(error.localizedDescription)", source: source)
                continue
            }
            // The record write above already succeeded — a failure past this point is a local
            // ledger/logging problem, not a publish failure, so it gets its own message rather
            // than falling into a shared catch that would misreport a live record as unpublished.
            ledger.record(StandardSitePublishLog.Entry(
                path: entry.path, uri: documentResult.uri,
                publishedAt: entry.publishedAt, lastPublishedAt: now()
            ))
            do {
                try ledger.save(to: configDirectory)
            } catch {
                failedCount += 1
                await logError(
                    "published \(entry.path) as \(documentResult.uri), but its ledger update failed: \(error.localizedDescription)",
                    source: source
                )
                continue
            }
            if wasAlreadyPublished {
                updatedCount += 1
                await logCenter.append(
                    source: source, stream: .stdout,
                    text: "standardsite: updated \(entry.path) as \(documentResult.uri)"
                )
            } else {
                publishedCount += 1
                await logCenter.append(
                    source: source, stream: .stdout,
                    text: "standardsite: published \(entry.path) as \(documentResult.uri)"
                )
            }
        }

        // No per-document "skipped" bucket here on purpose: deterministic rkeys mean every
        // eligible document is always re-put ("updates are free," per the design doc), so each
        // plan entry lands in exactly one of the three counts above. A document being excluded
        // from `plan.entries` in the first place (draft, future-dated) isn't a skip *this pass*
        // made — `StandardSiteDocumentPlan` never considered it eligible to begin with. The one
        // real skip concept — the whole pass not running at all — gets its own distinct log line
        // above ("skipped — ...") rather than a count folded into this summary.
        await logCenter.append(
            source: source, stream: .stdout,
            text: "standardsite: done — published \(publishedCount), updated \(updatedCount), failed \(failedCount)"
        )
    }

    /// Persists the session DID into `.site-config`'s `ATPROTO_DID` on first successful publish
    /// (needed by increment 2's build-time well-known/link-tag emission). Best-effort, like every
    /// other write-through call site — a write failure must never turn a successful publish pass
    /// into a failed one. Skipped once the recorded value already matches, mirroring
    /// `DeployCommand.persistWorkerDeployed`'s idempotent-write shape.
    private func persistDID(_ did: String, siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: Self.didConfigKey, in: config) != did else { return }
        let updated = SiteConfigFile.upsert([(Self.didConfigKey, did)], into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    private func iso8601(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private func logError(_ message: String, source: String) async {
        await logCenter.append(source: source, stream: .stderr, text: "standardsite: \(message)")
    }
}
