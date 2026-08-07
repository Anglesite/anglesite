import Foundation

/// Orchestrates #587's "pull staged submissions and commit them into the site's git working
/// copy" step: list what's staged in `INBOX_KV` (`InboxKVClient`), write + commit the new ones
/// (`InboxSubmissionCommitter`), then clear only the ones that made it into a commit. Designed to
/// be called once per site-open (`PreviewModel.open(site:)`).
public enum InboxSubmissionSync {
    /// Pulls every staged submission from `client`, commits the new ones into `siteDirectory`,
    /// and deletes only the ones that were actually committed — a submission that fails to write
    /// or commit stays staged for the next pull rather than being lost.
    public static func pullAndCommit(client: InboxKVClient, siteDirectory: URL) async -> Int {
        guard let submissions = try? await client.listStagedSubmissions(), !submissions.isEmpty else { return 0 }
        let committedIDs = await InboxSubmissionCommitter.commit(submissions: submissions, into: siteDirectory)
        for id in committedIDs {
            do {
                try await client.deleteSubmission(id: id)
            } catch {
                await LogCenter.shared.append(
                    source: "InboxSubmissionSync", stream: .stderr,
                    text: "Failed to delete staged submission \(id) from INBOX_KV after commit: "
                        + "\(error). It will be re-fetched and safely re-attempted on the next pull.")
            }
        }
        return committedIDs.count
    }

    /// Reads the site's `SiteSettings` and the Cloudflare API token from `secretStore`; no-ops
    /// (returns 0, no network call) unless both `provisionedWorkerResources.inboxAccountID` and
    /// `.inboxKVNamespaceID` are set and a token is available — i.e. inbox capture hasn't been
    /// provisioned for this site yet (#764). `configDirectory` is the package's `Config/`
    /// directory (`AnglesitePackage.configURL`), a sibling of `siteDirectory`
    /// (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        secretStore: any SecretStore = PlatformSecretStore.make(),
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let resources = settings.provisionedWorkerResources,
              let accountID = resources.inboxAccountID, !accountID.isEmpty,
              let namespaceID = resources.inboxKVNamespaceID, !namespaceID.isEmpty
        else { return 0 }
        guard let token = try? await CloudflareAPICredentials.resolve(secretStore: secretStore), !token.isEmpty
        else { return 0 }

        let client = InboxKVClient(
            accountID: accountID, namespaceID: namespaceID, apiToken: token, transport: transport)
        return await pullAndCommit(client: client, siteDirectory: siteDirectory)
    }
}
