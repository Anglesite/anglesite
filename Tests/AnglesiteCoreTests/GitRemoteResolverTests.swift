import Testing
import Foundation
@testable import AnglesiteCore

/// Tests for `GitRemoteResolver.origin(in:runner:)` — the shared "read `origin`, parse as
/// `RemoteRepo`" lookup extracted from `PlistEditorModel`/`SiteWindowModel`'s previously
/// duplicated copies (#975 final review). `RemoteRepo.parse(remoteURL:)`'s own parsing rules are
/// covered by `RemoteRepoTests`; these exercise the runner-plumbing wrapper around it.
@Suite struct GitRemoteResolverTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    @Test func parsesGitHubOriginFromSuccessfulRunner() async {
        let repo = await GitRemoteResolver.origin(in: tmpDir, runner: { siteDirectory, args in
            #expect(siteDirectory == self.tmpDir)
            #expect(args == ["remote", "get-url", "origin"])
            return .init(stdout: "https://github.com/acme/my-site.git\n", stderr: "", exitCode: 0)
        })
        #expect(repo?.owner == "acme")
        #expect(repo?.name == "my-site")
    }

    @Test func nilOnNonZeroExit() async {
        let repo = await GitRemoteResolver.origin(in: tmpDir, runner: { _, _ in
            .init(stdout: "", stderr: "fatal: No such remote 'origin'", exitCode: 128)
        })
        #expect(repo == nil)
    }

    @Test func nilWhenRunnerThrows() async {
        struct Boom: Error {}
        let repo = await GitRemoteResolver.origin(in: tmpDir, runner: { _, _ in throw Boom() })
        #expect(repo == nil)
    }

    @Test func nilForNonGitHubRemote() async {
        let repo = await GitRemoteResolver.origin(in: tmpDir, runner: { _, _ in
            .init(stdout: "https://gitlab.com/acme/my-site.git", stderr: "", exitCode: 0)
        })
        #expect(repo == nil)
    }
}
