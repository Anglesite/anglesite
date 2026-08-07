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
    /// `.site-config` key `siteID` is persisted under alongside the DID. Increment 2's template
    /// generators re-derive `POSSEStableKey`-style rkeys at build time with no network — that
    /// derivation is keyed on the site UUID (`siteID`), not just the DID, so both must be on disk
    /// before the template can reconstruct a document's or the publication's at-URI.
    static let siteIDConfigKey = "ATPROTO_SITE_ID"
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

        let iconFileURL = siteDirectory
            .appendingPathComponent(WebsiteIconAsset.publicDirectoryRelativePath, isDirectory: true)
            .appendingPathComponent(WebsiteIconAsset.icon512Name)

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

        let icon = await prepareImageBlob(
            fileURL: iconFileURL, label: "site icon", pdsURL: bluesky.pdsURL, session: session, source: source
        )
        let publication = StandardSitePublicationRecord(
            name: siteName, url: siteURL.absoluteString, description: description, icon: icon
        )

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
        persistIdentity(did: publicationResult.did, siteID: siteID, siteDirectory: siteDirectory)
        ledger.publicationURI = publicationResult.uri
        try? ledger.save(to: configDirectory)

        // Debug-pane visibility into the pass as a whole (#1233), not just each record — "logs
        // are sacred, no silent drops" extends to the shape of a successful run, not only its
        // failures.
        var publishedCount = 0
        var updatedCount = 0
        var failedCount = 0

        // Loaded once for the whole pass: every entry's `bskyPostRef` lookup below reads this
        // same snapshot rather than re-loading per document.
        let posseLedger = POSSESyndicationLog.load(from: configDirectory)

        for entry in plan.entries {
            let wasAlreadyPublished = ledger.entries.contains { $0.path == entry.path }
            let documentRkey = "anglesite-\(POSSEStableKey.make("\(siteID)\n\(entry.path)"))"
            let bskyPostRef = await resolveBskyPostRef(
                entry: entry, siteID: siteID, siteURL: siteURL, posseLedger: posseLedger,
                bluesky: bluesky, session: session
            )
            let coverImage = await resolveCoverImage(
                entry: entry, siteDirectory: siteDirectory, pdsURL: bluesky.pdsURL, session: session, source: source
            )
            let document = StandardSiteDocumentRecord(
                site: publicationResult.uri,
                title: entry.title,
                description: entry.description,
                path: entry.path,
                publishedAt: iso8601(entry.publishedAt),
                updatedAt: entry.updatedAt.map(iso8601),
                tags: entry.tags,
                textContent: entry.textContent,
                bskyPostRef: bskyPostRef,
                coverImage: coverImage
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

        // Unpublish (v1.1, #1234): a ledgered document whose path no longer appears in the
        // current plan means its source post was deleted, or renamed — deterministic rkeys are
        // keyed on path, so a rename orphans the old record the same way a deletion does (see the
        // design doc's open questions). Diff first, delete after, so a `deleteRecord` failure
        // leaves the ledger entry in place for the next pass to retry rather than losing track of
        // a record that's still live.
        let currentPaths = Set(plan.entries.map(\.path))
        let staleEntries = ledger.entries.filter { !currentPaths.contains($0.path) }
        var unpublishedCount = 0
        for staleEntry in staleEntries {
            guard let rkey = staleEntry.uri.split(separator: "/").last else { continue }
            do {
                try await AtprotoPutRecordClient.deleteRecord(
                    collection: "site.standard.document", rkey: String(rkey),
                    pdsURL: bluesky.pdsURL, session: session, transport: transport
                )
            } catch {
                failedCount += 1
                await logError("couldn't unpublish \(staleEntry.path): \(error.localizedDescription)", source: source)
                continue
            }
            ledger.entries.removeAll { $0.path == staleEntry.path }
            do {
                try ledger.save(to: configDirectory)
            } catch {
                await logError(
                    "unpublished \(staleEntry.path), but its ledger update failed: \(error.localizedDescription)",
                    source: source
                )
                continue
            }
            unpublishedCount += 1
            await logCenter.append(
                source: source, stream: .stdout, text: "standardsite: unpublished \(staleEntry.path)"
            )
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
            text: "standardsite: done — published \(publishedCount), updated \(updatedCount), "
                + "unpublished \(unpublishedCount), failed \(failedCount)"
        )
    }

    /// Resolves the strong reference to link `entry`'s document to the Bluesky post it was
    /// cross-posted as (v1.1, #1234), or `nil` when there is none yet. Independent of
    /// `POSSESyndicationCommand`/`BlueskyPOSSEClient` by design: both this pass and POSSE derive
    /// the same deterministic Bluesky rkey from the same site + canonical URL inputs (see
    /// ``POSSEStableKey``), and both authenticate the same Bluesky account, so the post's at-URI
    /// is computable without any coordination — only its `cid` needs a lookup. Because
    /// `publishStandardSite` runs *before* `syndicate` in `runPostDeploySequencing`, the earliest
    /// a document can carry its `bskyPostRef` is the deploy *after* the one that first
    /// cross-posted it — this reads whatever `POSSESyndicationLog` a prior deploy already wrote.
    private func resolveBskyPostRef(
        entry: StandardSiteDocumentPlan.Entry,
        siteID: String,
        siteURL: URL,
        posseLedger: POSSESyndicationLog?,
        bluesky: POSSECredentials.Bluesky,
        session: AtprotoPutRecordClient.Session
    ) async -> AtprotoPutRecordClient.StrongRef? {
        guard let posseLedger,
              let canonicalURL = URL(string: entry.path, relativeTo: siteURL)?.absoluteURL,
              posseLedger.contains(canonicalURL: canonicalURL, platform: "bluesky")
        else { return nil }
        let rkey = "anglesite-\(POSSEStableKey.make("\(siteID)\n\(canonicalURL.absoluteString)\nbluesky"))"
        // Best-effort: a lookup failure (network hiccup, the post since deleted) just means no
        // linkage this pass, not a publish failure — the next pass tries again.
        guard let ref = try? await AtprotoPutRecordClient.getRecord(
            collection: "app.bsky.feed.post", repo: session.did, rkey: rkey,
            pdsURL: bluesky.pdsURL, session: session, transport: transport
        ) else { return nil }
        return ref
    }

    /// Resolves `entry`'s frontmatter `image` field to an uploaded cover-image blob (v1.1,
    /// #1234), or `nil` when the post has none. Only a root-relative path (`/uploads/hero.jpg` —
    /// Astro's `public/` served at the site root, the same convention `LogoAsset`/`WebsiteIconAsset`
    /// use) resolves to a local file; anything else (an external URL, a colocated-asset relative
    /// path) is left unresolved rather than guessed at.
    private func resolveCoverImage(
        entry: StandardSiteDocumentPlan.Entry,
        siteDirectory: URL,
        pdsURL: URL,
        session: AtprotoPutRecordClient.Session,
        source: String
    ) async -> AtprotoPutRecordClient.BlobRef? {
        guard let sourcePath = entry.coverImageSourcePath, sourcePath.hasPrefix("/") else { return nil }
        let fileURL = siteDirectory
            .appendingPathComponent(WebsiteIconAsset.publicDirectoryRelativePath, isDirectory: true)
            .appendingPathComponent(String(sourcePath.dropFirst()))
        return await prepareImageBlob(
            fileURL: fileURL, label: "\(entry.path) cover image", pdsURL: pdsURL, session: session, source: source
        )
    }

    /// Reads and uploads one local image as a Standard.site blob field (v1.1, #1234) — shared by
    /// the publication `icon` and each document's `coverImage`. Never throws: a missing file, an
    /// unsupported extension, or an oversize image (see ``StandardSiteImageBlob`` — no
    /// downscaling yet) all degrade to "no blob for this field" rather than failing the pass.
    /// `.fileNotFound` stays silent — the common case is simply no icon/cover image configured,
    /// nothing for the owner to act on — but the other two skip reasons mean the owner *did* set
    /// something (an oversize file, or an extension this doesn't recognize) that's silently not
    /// showing up on the Atmosphere side, so both are worth a log line.
    private func prepareImageBlob(
        fileURL: URL,
        label: String,
        pdsURL: URL,
        session: AtprotoPutRecordClient.Session,
        source: String
    ) async -> AtprotoPutRecordClient.BlobRef? {
        switch StandardSiteImageBlob.prepare(fileURL: fileURL) {
        case .success(let prepared):
            do {
                return try await AtprotoPutRecordClient.uploadBlob(
                    data: prepared.data, mimeType: prepared.mimeType,
                    pdsURL: pdsURL, session: session, transport: transport
                )
            } catch {
                await logError("couldn't upload \(label): \(error.localizedDescription)", source: source)
                return nil
            }
        case .failure(.tooLarge(let bytes)):
            await logCenter.append(
                source: source, stream: .stdout,
                text: "standardsite: skipped \(label) — \(bytes) bytes exceeds the 1 MB limit (no downscaling yet)"
            )
            return nil
        case .failure(.unsupportedExtension(let ext)):
            await logCenter.append(
                source: source, stream: .stdout,
                text: "standardsite: skipped \(label) — unrecognized image extension \"\(ext)\""
            )
            return nil
        case .failure(.fileNotFound):
            return nil
        }
    }

    /// Persists the session DID and site UUID into `.site-config` (`ATPROTO_DID`/`ATPROTO_SITE_ID`)
    /// on first successful publish — needed by increment 2's build-time well-known/link-tag
    /// emission, which must reconstruct `POSSEStableKey`-style rkeys with no network. Best-effort,
    /// like every other write-through call site — a write failure must never turn a successful
    /// publish pass into a failed one. Each key is skipped once its recorded value already
    /// matches, mirroring `DeployCommand.persistWorkerDeployed`'s idempotent-write shape.
    private func persistIdentity(did: String, siteID: String, siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        var updates: [(String, String)] = []
        if SiteConfigFile.value(forKey: Self.didConfigKey, in: config) != did {
            updates.append((Self.didConfigKey, did))
        }
        if SiteConfigFile.value(forKey: Self.siteIDConfigKey, in: config) != siteID {
            updates.append((Self.siteIDConfigKey, siteID))
        }
        guard !updates.isEmpty else { return }
        let updated = SiteConfigFile.upsert(updates, into: config)
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
