import Foundation

/// `AuditRunner` that notices when a GitHub-backed site publishes a `security.txt` that doesn't
/// route reports to the repo's private advisory form (#843).
///
/// Deliberately spawns nothing and uses no GitHub token: an audit shouldn't make authenticated
/// network calls to decide whether to show an informational hint. The real verification — repo
/// visibility and private-vulnerability-reporting state — happens in Website Settings ▸ Security
/// Reports, where the owner is actually acting. The accepted consequence is that this hint can
/// fire for a repo that turns out to be private; the Settings tab then explains why the offer
/// isn't available. A hint that resolves to "not applicable" costs nothing, whereas skipping it
/// silently would hide the feature from exactly the owners it targets.
public struct SecurityTxtAuditRunner: AuditRunner {
    public let category: AuditReport.Finding.Category = .security

    private let gitRunner: BackupCommand.GitRunner

    /// `gitRunner` defaults to `BackupCommand.defaultRunner`, which already carries the
    /// Darwin (in-process SwiftGit2) / non-Darwin (subprocess `git`) split — `InProcessGit`
    /// itself is Darwin-only, so this runner must not reference it directly.
    public init(gitRunner: @escaping BackupCommand.GitRunner = BackupCommand.defaultRunner) {
        self.gitRunner = gitRunner
    }

    public func run(
        siteDirectory: URL,
        executor: any AuditExecutor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding] {
        guard let repo = await remoteRepo(in: siteDirectory) else { return [] }
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let settings = SecurityReportingAsset.parseSettings(from: config)
        // Manual mode: the owner hand-maintains security.txt themselves, so Anglesite has no file
        // to route a contact through and the hint would be unfixable by following its own
        // remediation. Disabled mode: the owner has opted out of publishing one at all. Either
        // way the hint is wrong, not just unhelpful.
        guard settings.mode == .generated else { return [] }
        guard !SecurityReportingAsset.usesAdvisoryForm(settings.contacts, repo: repo) else { return [] }

        return [AuditReport.Finding(
            category: .security,
            severity: .info,
            title: "Vulnerability reports aren’t routed to GitHub",
            detail: "This site is backed by \(repo.owner)/\(repo.name), but security.txt doesn’t list that repository’s private advisory form as a contact.",
            remediation: "Open Website Settings ▸ Security Reports to route vulnerability reports to the repository’s private advisory form.",
            location: WebsiteAnalyticsAsset.configRelativePath
        )]
    }

    /// The site's GitHub `origin`, or nil when there is no remote, git can't run, or the remote
    /// isn't GitHub (`RemoteRepo.parse` rejects every other host). None of those is an audit
    /// failure — a site without a GitHub remote is a normal state, so this never throws.
    private func remoteRepo(in siteDirectory: URL) async -> RemoteRepo? {
        guard let result = try? await gitRunner(siteDirectory, ["remote", "get-url", "origin"]),
              result.exitCode == 0 else { return nil }
        return RemoteRepo.parse(remoteURL: result.stdout)
    }
}
