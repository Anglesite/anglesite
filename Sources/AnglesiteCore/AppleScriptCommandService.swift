import Foundation

/// Testable command kernel for the app target's Cocoa Scripting adapters.
///
/// AppleScript commands are synchronous Objective-C entry points, but the work they trigger is
/// already async Swift. Keep policy, site resolution, and result formatting here so the app target
/// can stay a small Apple Event adapter instead of growing another operation stack.
public struct AppleScriptCommandService: Sendable {
    /// Failures a script author can cause and fix. `LocalizedError` because the Apple Event
    /// adapter reports `errorDescription` verbatim as the AppleScript error message — these
    /// strings are the scripting UX, not internal diagnostics.
    public enum CommandError: LocalizedError, Equatable {
        /// The site specifier was empty or all whitespace.
        case emptySiteSpecifier
        /// No registered site matched the specifier by UUID, path, or exact name.
        case siteNotFound(String)
        /// More than one registered site matched (e.g. two sites share a display name).
        /// `matches` carries the candidate names so the script author can disambiguate —
        /// guessing on the caller's behalf could deploy or edit the wrong site.
        case ambiguousSite(String, matches: [String])
        /// `deploy` was called without `with allowing unattended` (see
        /// ``AppleScriptCommandService/deploySite(_:allowingUnattended:)``).
        case deployRequiresUnattendedOptIn(String)

        /// The AppleScript-facing message for each case — phrased as instructions to the script
        /// author, since this is what the `osascript` error surface shows.
        public var errorDescription: String? {
            switch self {
            case .emptySiteSpecifier:
                return "Specify a site by UUID, exact name, or registered package path."
            case .siteNotFound(let specifier):
                return "Could not find a registered Anglesite site matching \(specifier)."
            case .ambiguousSite(let specifier, let matches):
                return "More than one site matches \(specifier): \(matches.joined(separator: ", "))."
            case .deployRequiresUnattendedOptIn(let name):
                return "Deploying \(name) from AppleScript requires `with allowing unattended`."
            }
        }
    }

    private let store: SiteStore
    private let operations: any SiteOperationsService
    private let content: any ContentOperationsService
    private let graph: SiteContentGraph
    private let loadSites: @Sendable () async throws -> Void

    /// Every dependency is injectable so the command policy is testable without a real site on
    /// disk; the defaults wire up the production stack (`nil` rather than default expressions for
    /// the service parameters because their defaults derive from `store`).
    public init(
        store: SiteStore = .shared,
        operations: (any SiteOperationsService)? = nil,
        content: (any ContentOperationsService)? = nil,
        graph: SiteContentGraph = SiteContentGraph(),
        loadSites: (@Sendable () async throws -> Void)? = nil
    ) {
        self.store = store
        self.operations = operations ?? SiteOperations(store: store)
        self.graph = graph
        self.loadSites = loadSites ?? { try await store.load() }
        self.content = content ?? ContentCreationWorkflow.native(
            contentGraph: graph,
            siteDirectory: { id in await store.find(id: id)?.sourceDirectory }
        )
    }

    /// Resolves a script-supplied specifier to exactly one registered site, trying UUID
    /// (case-insensitive), then canonicalized package/`Source/` path, then exact display name —
    /// most-unambiguous first, so a UUID can never be shadowed by a same-looking name. Ambiguity
    /// throws ``CommandError/ambiguousSite(_:matches:)`` rather than picking a winner: scripts
    /// run unattended, and acting on the wrong site is worse than failing.
    public func resolveSite(_ specifier: String) async throws -> SiteStore.Site {
        let needle = specifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { throw CommandError.emptySiteSpecifier }

        try await loadSites()
        let sites = await store.sites

        if let site = sites.first(where: { $0.id.caseInsensitiveCompare(needle) == .orderedSame }) {
            return site
        }

        let pathMatches = sites.filter { site in
            let canonicalNeedle = Self.canonicalPath(needle)
            guard !canonicalNeedle.isEmpty else { return false }
            return canonicalNeedle == Self.canonicalPath(site.packageURL.path)
                || canonicalNeedle == Self.canonicalPath(site.sourceDirectory.path)
        }
        if let resolved = try singleMatch(pathMatches, specifier: needle) {
            return resolved
        }

        let nameMatches = sites.filter { $0.name.caseInsensitiveCompare(needle) == .orderedSame }
        if let resolved = try singleMatch(nameMatches, specifier: needle) {
            return resolved
        }

        throw CommandError.siteNotFound(needle)
    }

    /// Resolves the site and bumps its recency in ``SiteStore`` (best-effort — a failed touch
    /// shouldn't fail the open). The actual window presentation is the app target's job; this
    /// returns the resolved site for the adapter to hand to the scene layer.
    public func openSite(_ specifier: String) async throws -> SiteStore.Site {
        let site = try await resolveSite(specifier)
        try? await store.touch(id: site.id)
        return site
    }

    /// Deploys the site and returns the human-readable outcome dialog. Publishing to the live
    /// site from an unattended script is consequential enough that it requires the explicit
    /// AppleScript opt-in (`with allowing unattended`) — without it this throws instead of
    /// deploying, so an automation can't publish by accident.
    public func deploySite(_ specifier: String, allowingUnattended: Bool) async throws -> String {
        let site = try await resolveSite(specifier)
        guard allowingUnattended else {
            throw CommandError.deployRequiresUnattendedOptIn(site.name)
        }
        return SiteOperations.dialog(forDeploy: await operations.deploy(site: site))
    }

    /// Backs up the site and returns the outcome as ``SiteOperations``'s dialog string — results
    /// are AppleScript display text, not structured data, matching how scripts consume them.
    public func backupSite(_ specifier: String) async throws -> String {
        let site = try await resolveSite(specifier)
        return SiteOperations.dialog(forBackup: await operations.backup(site: site))
    }

    /// Runs the structured audit (``AuditCommand``) and returns its outcome dialog. No opt-in
    /// needed — unlike deploy, an audit only reads the site.
    public func auditSite(_ specifier: String) async throws -> String {
        let site = try await resolveSite(specifier)
        return SiteOperations.dialog(forAudit: await operations.audit(site: site))
    }

    /// One-sentence content summary (pages, posts, drafts, images) from ``SiteContentGraph`` —
    /// prose rather than a record because AppleScript callers display it directly.
    public func siteStatus(_ specifier: String) async throws -> String {
        let site = try await resolveSite(specifier)
        let posts = await graph.posts(for: site.id)
        let pages = await graph.pages(for: site.id).count
        let images = await graph.images(for: site.id).count
        let drafts = posts.filter(\.draft).count
        return "\(site.name) has \(Self.count(pages, "page")), \(Self.count(posts.count, "post")) (\(Self.count(drafts, "draft"))), and \(Self.count(images, "image"))."
    }

    /// Creates a page through the same native content workflow the app UI uses. A blank `route`
    /// is normalized to `nil` (AppleScript optional parameters often arrive as empty strings) so
    /// the workflow derives the route from `name`. Creation failures are reported in the returned
    /// dialog string, not thrown — only site resolution throws.
    public func addPage(_ specifier: String, name: String, route: String?) async throws -> String {
        let site = try await resolveSite(specifier)
        let cleanRoute = Self.nilIfBlank(route)
        let result = await content.createPage(siteID: site.id, name: name, route: cleanRoute)
        return Self.createdDialog(result, kind: "page", siteName: site.name)
    }

    /// Creates a post, mirroring ``addPage(_:name:route:)``: blank `collection`/`slug` normalize
    /// to `nil` so the workflow applies its own defaults, and creation failures come back as
    /// dialog text rather than thrown errors.
    public func addPost(_ specifier: String, title: String, collection: String?, slug: String?) async throws -> String {
        let site = try await resolveSite(specifier)
        let result = await content.createPost(
            siteID: site.id,
            title: title,
            collection: Self.nilIfBlank(collection),
            slug: Self.nilIfBlank(slug)
        )
        return Self.createdDialog(result, kind: "post", siteName: site.name)
    }

    private func singleMatch(_ matches: [SiteStore.Site], specifier: String) throws -> SiteStore.Site? {
        switch matches.count {
        case 0:
            return nil
        case 1:
            return matches[0]
        default:
            throw CommandError.ambiguousSite(specifier, matches: matches.map(\.name).sorted())
        }
    }

    private static func createdDialog(_ result: ContentCreateResult, kind: String, siteName: String) -> String {
        switch result {
        case .created(_, let identifier):
            return "Added a \(kind) at \(identifier) on \(siteName)."
        case .siteNotFound:
            return "Could not find \(siteName)."
        case .failed(let reason):
            return "Could not add the \(kind): \(reason)"
        }
    }

    private static func count(_ value: Int, _ singular: String) -> String {
        value == 1 ? "1 \(singular)" : "\(value) \(singular)s"
    }

    private static func nilIfBlank(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private static func canonicalPath(_ raw: String) -> String {
        let expanded = (raw as NSString).expandingTildeInPath
        guard expanded.hasPrefix("/") else { return "" }
        return URL(fileURLWithPath: expanded)
            .standardizedFileURL
            .resolvingSymlinksInPath()
            .path
    }
}
