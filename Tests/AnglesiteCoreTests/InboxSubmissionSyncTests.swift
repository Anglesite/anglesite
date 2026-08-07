import Testing
import Foundation
@testable import AnglesiteCore

// Serialized: `pullsCommitsAndDeletes` spawns real `git` subprocesses via raw `Process()` (not
// `ProcessSupervisor`) in `makeThrowawayGitRepo()`. See the identical note on
// `InboxSubmissionCommitterTests` — running these concurrently with the rest of the suite's own
// subprocess-heavy tests appears to trip a rare native heap-corruption crash in CI.
@Suite(.serialized)
struct InboxSubmissionSyncTests {
    private static func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: status,
                         httpVersion: nil, headerFields: nil)!
    }

    @Test("pulls, commits, and deletes only successfully committed submissions")
    func pullsCommitsAndDeletes() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let keysBody = Data("""
        {"success": true, "result": [{"name": "inbox:abc"}]}
        """.utf8)
        let submissionBody = Data("""
        {"id": "abc", "subject": "Hello", "from": "a@example.com", "message": "Hi", "receivedAt": "2026-07-10T00:00:00Z"}
        """.utf8)
        let deleted = DeletedIDs()

        let client = InboxKVClient(accountID: "acct1", namespaceID: "ns1", apiToken: "token", transport: { request in
            if request.httpMethod == "DELETE" {
                await deleted.append(String(request.url!.lastPathComponent.dropFirst("inbox:".count)))
                return (Data(), Self.response(200))
            }
            if request.url!.path.hasSuffix("/keys") { return (keysBody, Self.response(200)) }
            if request.url!.path.hasSuffix("/values/inbox:abc") { return (submissionBody, Self.response(200)) }
            return (Data(), Self.response(404))
        })

        let count = await InboxSubmissionSync.pullAndCommit(client: client, siteDirectory: siteDirectory)
        #expect(count == 1)
        let deletedIDs = await deleted.values
        #expect(deletedIDs == ["abc"])
    }

    @Test("returns 0 without any network call when nothing is staged")
    func noStagedSubmissionsIsNoOp() async throws {
        let keysBody = Data("""
        {"success": true, "result": []}
        """.utf8)
        let client = InboxKVClient(accountID: "acct1", namespaceID: "ns1", apiToken: "token", transport: { _ in
            (keysBody, Self.response(200))
        })
        let count = await InboxSubmissionSync.pullAndCommit(
            client: client, siteDirectory: URL(fileURLWithPath: "/nonexistent"))
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured no-ops when the site has no inbox capture settings")
    func noOpsWithoutConfiguration() async {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }

        let count = await InboxSubmissionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "unused"))
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured no-ops when only the account id is set")
    func noOpsWithPartialConfigurationMissingNamespace() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(inboxAccountID: "acct1")))

        let count = await InboxSubmissionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "unused"))
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured no-ops (with no network call) when both ids are set but no token is stored")
    func noOpsWithBothIDsSetButNoToken() async throws {
        // `CloudflareAPICredentials.resolve()` (#1211) checks this env var before falling back to
        // `secretStore` — claim it cleared via the shared coordinator so a concurrent "set" test
        // elsewhere in this target (#1282's cross-suite leak, #1211 review) can't turn this into a
        // false pass. Released afterward regardless of outcome.
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(inboxKVNamespaceID: "ns1", inboxAccountID: "acct1")))

        let count = await InboxSubmissionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: nil),
            transport: { _ in
                Issue.record("transport must not be called when no Cloudflare token is available")
                struct UnexpectedNetworkCall: Error {}
                throw UnexpectedNetworkCall()
            })
        #expect(count == 0)
    }

    private static func makeThrowawayGitRepo() throws -> URL {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-repo-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try "placeholder\n".write(to: dir.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)

        func git(_ args: [String]) throws {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = args
            p.currentDirectoryURL = dir
            p.environment = ProcessInfo.processInfo.environment.merging([
                "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@anglesite.test",
                "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@anglesite.test",
            ]) { _, new in new }
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0 else {
                struct GitFailed: Error {}
                throw GitFailed()
            }
        }
        try git(["init", "-q"])
        // Repo-local identity: the code under test commits via SwiftGit2 on Darwin, whose
        // `defaultSignature()` reads git config — the GIT_AUTHOR_*/GIT_COMMITTER_* env vars
        // above only cover this fixture's own subprocess commits. Same pattern as
        // `NativeContentOperationsTests`.
        try git(["config", "user.email", "test@anglesite.test"])
        try git(["config", "user.name", "test"])
        try git(["add", "-A"])
        try git(["commit", "-q", "-m", "initial"])
        return dir
    }
}

private actor DeletedIDs {
    private(set) var values: [String] = []
    func append(_ id: String) { values.append(id) }
}

private struct FakeSecretStore: SecretStore {
    let token: String?
    func read(account: String) throws -> String? { account == SecretAccounts.cloudflareToken ? token : nil }
    func write(_ value: String, account: String) throws {}
    func delete(account: String) throws {}
}
