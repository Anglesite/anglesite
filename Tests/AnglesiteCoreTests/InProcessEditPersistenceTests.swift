import Foundation
import Testing
@testable import AnglesiteCore

/// The container edit-sync import path: a commit made by the MCP sidecar inside the container is
/// handed back to the host and replayed onto the canonical `Source/` repository.
///
/// The fixture exports a **real thin git bundle** — `git bundle create … refs/heads/anglesite-persist
/// ^parent`, byte-for-byte what `LocalContainerSiteRuntime.persistEdit`'s guest script produces.
/// These tests originally had to substitute a repository directory, because libgit2 has no bundle
/// support and `Repository.clone(from:)` rejected every bundle; #988 closed that with
/// `Repository.unbundle(at:)` in the fork, so they now exercise the real artifact end to end.
struct InProcessEditPersistenceTests {
    @Test("importBundle commits the overlay edit with the app identity when none is configured")
    func importsWithAppFallbackIdentity() async throws {
        // #969: under App Sandbox `HOME` is redirected into the app's container, so libgit2 can't
        // read the user's ~/.gitconfig and `defaultSignature()` fails unless the site repo carries
        // a *repo-local* identity — which a stock machine's doesn't. Worse than a clean refusal:
        // the failure lands after the guest tree has already been written into the worktree, so
        // the edit is left uncommitted and every later import trips the "canonical Source
        // repository has uncommitted changes" guard on the way in.
        //
        // An empty repo-local user.name/user.email is the deterministic way to reproduce a
        // `defaultSignature()` failure on a dev/CI machine that has a real ambient global identity
        // (the same trigger `NativeContentOperationsTests` uses — a merely *absent* local identity
        // would silently fall through to it, and libgit2's config-search-path cache is
        // process-global, so mutating HOME mid-test can't truncate the chain the way the sandbox
        // does).
        let fixture = try await EditSyncFixture.make(hostIdentity: .none)
        defer { fixture.cleanUp() }

        try await InProcessEditPersistence.importBundle(
            fixture.bundle, commit: fixture.guestCommit, into: fixture.host)

        #expect(try String(contentsOf: fixture.host.appendingPathComponent("p.astro"), encoding: .utf8) == "two\n")
        #expect(try await fixture.hostAuthor() == "Anglesite <noreply@anglesite.app>")
        #expect(try await fixture.hostSubject() == "overlay edit")
        // Replayed, not fast-forwarded: the host records its own commit over the guest's tree.
        #expect(try await fixture.hostHead() != fixture.guestCommit)
        // The commit really landed — a signature failure would leave the replayed tree uncommitted.
        #expect(try await fixture.hostStatus() == "")
    }

    @Test("importBundle prefers the repository's configured identity over the app fallback")
    func importsWithConfiguredIdentity() async throws {
        let fixture = try await EditSyncFixture.make(hostIdentity: .configured)
        defer { fixture.cleanUp() }

        try await InProcessEditPersistence.importBundle(
            fixture.bundle, commit: fixture.guestCommit, into: fixture.host)

        #expect(try await fixture.hostAuthor() == "host <host@t.io>")
    }

    @Test("importBundle refuses an overlay edit that no longer sits on the host's HEAD")
    func refusesDivergedHost() async throws {
        // Fast-forward only, by design: a native host-side content operation committed after the
        // runtime was hydrated must not be silently overwritten. Worth covering now because it
        // was unreachable before #988 — every import died at the bundle clone, so no guard past
        // that point had ever run against a real artifact.
        let fixture = try await EditSyncFixture.make(hostIdentity: .configured)
        defer { fixture.cleanUp() }
        try await fixture.commitOnHost(file: "native.astro", contents: "native edit\n")
        let divergedHead = try await fixture.hostHead()

        await #expect(throws: SiteRuntimePersistenceError.self) {
            try await InProcessEditPersistence.importBundle(
                fixture.bundle, commit: fixture.guestCommit, into: fixture.host)
        }

        // Refused, not half-applied: HEAD is untouched and the worktree is clean, so the next
        // import isn't wedged by the "uncommitted changes" guard on the way in.
        #expect(try await fixture.hostHead() == divergedHead)
        #expect(try await fixture.hostStatus() == "")
    }
}

/// A host `Source/` repo plus the guest's export: one commit on top of the host's HEAD, bundled
/// exactly the way `LocalContainerSiteRuntime.persistEdit`'s guest script bundles it — onto a
/// `refs/heads/anglesite-persist` ref, thin against the parent.
private struct EditSyncFixture {
    enum HostIdentity { case none, configured }

    let root: URL
    let host: URL
    let bundle: URL
    let guestCommit: String

    /// Call from a `defer` in the test — the fixture is built and used across `await`s, so it
    /// can't clean up inside `make`.
    func cleanUp() { try? FileManager.default.removeItem(at: root) }

    static func make(hostIdentity: HostIdentity) async throws -> EditSyncFixture {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("edit-sync-\(UUID().uuidString)", isDirectory: true)
        let host = root.appendingPathComponent("Source", isDirectory: true)
        let guest = root.appendingPathComponent("guest", isDirectory: true)
        try FileManager.default.createDirectory(at: host, withIntermediateDirectories: true)

        try await git(["init"], in: host)
        try await git(["config", "user.email", "seed@t.io"], in: host)
        try await git(["config", "user.name", "seed"], in: host)
        try "one\n".write(to: host.appendingPathComponent("p.astro"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: host)
        try await git(["commit", "-m", "seed"], in: host)

        // The container's clone of the host repo, committing under the image's own git identity —
        // which is no more the user's than the app's is, hence the host-side signature.
        try await git(["clone", host.path, guest.path], in: root)
        try await git(["config", "user.email", "guest@t.io"], in: guest)
        try await git(["config", "user.name", "guest"], in: guest)
        try "two\n".write(to: guest.appendingPathComponent("p.astro"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: guest)
        try await git(["commit", "-m", "overlay edit"], in: guest)
        let guestCommit = try await git(["rev-parse", "HEAD"], in: guest)
        let parent = try await git(["rev-parse", "HEAD^"], in: guest)
        try await git(["update-ref", "refs/heads/anglesite-persist", guestCommit], in: guest)
        // Thin, against the parent — the same `git bundle create "$ref" "^$parent"` the guest
        // script runs, so the fixture stands or falls on the real transport.
        let bundle = root.appendingPathComponent("edit.bundle")
        try await git(["bundle", "create", bundle.path, "refs/heads/anglesite-persist", "^\(parent)"], in: guest)

        // Set the host identity last, so the seed commit above could still be made.
        switch hostIdentity {
        case .none:
            try await git(["config", "user.email", ""], in: host)
            try await git(["config", "user.name", ""], in: host)
        case .configured:
            try await git(["config", "user.email", "host@t.io"], in: host)
            try await git(["config", "user.name", "host"], in: host)
        }
        return EditSyncFixture(root: root, host: host, bundle: bundle, guestCommit: guestCommit)
    }

    /// A native host-side commit landing after the guest's bundle was exported.
    func commitOnHost(file: String, contents: String) async throws {
        try contents.write(to: host.appendingPathComponent(file), atomically: true, encoding: .utf8)
        try await Self.git(["add", "-A"], in: host)
        // -c rather than config: the `.none` fixture blanks the repo identity, and this commit
        // stands in for the user's own work, not the app's.
        try await Self.git(
            ["-c", "user.email=native@t.io", "-c", "user.name=native", "commit", "-m", "native"], in: host)
    }

    func hostHead() async throws -> String { try await Self.git(["rev-parse", "HEAD"], in: host) }
    func hostAuthor() async throws -> String { try await Self.git(["log", "-1", "--format=%an <%ae>"], in: host) }
    func hostSubject() async throws -> String { try await Self.git(["log", "-1", "--format=%s"], in: host) }
    func hostStatus() async throws -> String { try await Self.git(["status", "--porcelain"], in: host) }

    @discardableResult
    private static func git(_ arguments: [String], in directory: URL) async throws -> String {
        let result = try await ProcessSupervisor.shared.run(
            executable: URL(fileURLWithPath: "/usr/bin/git"), arguments: arguments, currentDirectoryURL: directory)
        return result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
