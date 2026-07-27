import Foundation

/// Read-only access to the GitHub repository settings that decide whether a repo's private
/// advisory form is usable by an outside reporter. Split read/write following the
/// `CloudflareReading`/`CloudflareWriting` pattern, so a UI that only inspects state can't
/// accidentally be handed a writer.
public protocol RepoSecurityReading: Sendable {
    /// `GET /repos/{owner}/{repo}` → the `private` flag. A private repo's advisory form is
    /// invisible to anyone without repo access.
    func isPrivate(owner: String, name: String, token: String) async throws -> Bool

    /// `GET /repos/{owner}/{repo}/private-vulnerability-reporting` → the `enabled` flag.
    func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool
}

/// Write access to a repository's private-vulnerability-reporting setting.
///
/// Enable only. GitHub also exposes a `DELETE` on the same route, but Anglesite never disables a
/// reporting channel it didn't create — that would be a surprising outward-facing side effect
/// from a website editor.
public protocol RepoSecurityWriting: Sendable {
    /// `PUT /repos/{owner}/{repo}/private-vulnerability-reporting`. Requires admin access to the
    /// repository; a token without it throws `GitHubRepoAPIError.unauthorized`.
    func enablePrivateVulnerabilityReporting(owner: String, name: String, token: String) async throws
}
