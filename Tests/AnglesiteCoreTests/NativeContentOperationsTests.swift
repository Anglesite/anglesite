// Tests/AnglesiteCoreTests/NativeContentOperationsTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("NativeContentOperations")
struct NativeContentOperationsTests {

    /// A temp site dir + a spy git closure that records calls and returns a fake SHA.
    private func makeOps() -> (ops: NativeContentOperations, root: URL, calls: Spy) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let spy = Spy()
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { proj, rel, msg in await spy.record(proj, rel, msg); return "deadbeef" },
            now: { Date(timeIntervalSince1970: 1_750_000_000) }
        )
        return (ops, root, spy)
    }

    actor Spy {
        private(set) var calls: [(URL, String, String)] = []
        func record(_ a: URL, _ b: String, _ c: String) { calls.append((a, b, c)) }
    }

    @Test("createPage writes the file and returns the normalized route")
    func createPage() async throws {
        let (ops, root, spy) = makeOps()
        let result = await ops.createPage(siteID: "s1", name: "About Us", route: nil)
        #expect(result == .created(filePath: "src/pages/about-us.astro", identifier: "/about-us"))
        let written = try String(contentsOf: root.appendingPathComponent("src/pages/about-us.astro"), encoding: .utf8)
        #expect(written == ContentScaffold.renderPage(title: "About Us", layoutImport: "../layouts/BaseLayout.astro"))
        let calls = await spy.calls
        #expect(calls.count == 1)
        #expect(calls.first?.1 == "src/pages/about-us.astro")
        #expect(calls.first?.2 == "anglesite: add page /about-us")
    }

    @Test("nested route writes under nested dirs with deeper layout import")
    func createNestedPage() async throws {
        let (ops, root, _) = makeOps()
        let result = await ops.createPage(siteID: "s1", name: "ignored", route: "/services/web")
        #expect(result == .created(filePath: "src/pages/services/web.astro", identifier: "/services/web"))
        let written = try String(contentsOf: root.appendingPathComponent("src/pages/services/web.astro"), encoding: .utf8)
        #expect(written.contains("import BaseLayout from \"../../layouts/BaseLayout.astro\";"))
    }

    @Test("createPage refuses the site root")
    func createPageRoot() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createPage(siteID: "s1", name: "/", route: "/")
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("site root"))
    }

    @Test("createPage won't overwrite an existing page")
    func createPageExisting() async {
        let (ops, root, _) = makeOps()
        let dir = root.appendingPathComponent("src/pages", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? "x".write(to: dir.appendingPathComponent("about.astro"), atomically: true, encoding: .utf8)
        let result = await ops.createPage(siteID: "s1", name: "About", route: nil)
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("already exists"))
    }

    @Test("createPage uses the copy generator's suggested description")
    func createPageUsesSuggestedDescription() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { _, _, _ in "deadbeef" },
            now: { Date(timeIntervalSince1970: 1_750_000_000) },
            copyGenerator: StubPageCopyGenerator(suggestion: PageCopySuggestion(description: "Meet our team."))
        )
        let result = await ops.createPage(siteID: "s1", name: "About", route: nil)
        #expect(result == .created(filePath: "src/pages/about.astro", identifier: "/about"))
        let written = try String(contentsOf: root.appendingPathComponent("src/pages/about.astro"), encoding: .utf8)
        #expect(written.contains("description=\"Meet our team.\""))
    }

    @Test("unknown site returns .siteNotFound")
    func siteNotFound() async {
        let ops = NativeContentOperations(siteDirectory: { _ in nil }, gitCommit: { _, _, _ in nil })
        let result = await ops.createPage(siteID: "missing", name: "About", route: nil)
        #expect(result == .siteNotFound)
    }

    @Test("createPost writes a draft in the default posts collection")
    func createPost() async throws {
        let (ops, root, spy) = makeOps()
        let result = await ops.createPost(siteID: "s1", title: "Hello World", collection: nil, slug: nil)
        #expect(result == .created(filePath: "src/content/posts/hello-world.md", identifier: "hello-world"))
        let written = try String(contentsOf: root.appendingPathComponent("src/content/posts/hello-world.md"), encoding: .utf8)
        #expect(written.contains("draft: true"))
        let calls = await spy.calls
        #expect(calls.first?.2 == "anglesite: add posts hello-world")
    }

    @Test("createPost uses the copy generator's suggested description")
    func createPostUsesSuggestedDescription() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { _, _, _ in "deadbeef" },
            now: { Date(timeIntervalSince1970: 1_750_000_000) },
            copyGenerator: StubPageCopyGenerator(suggestion: PageCopySuggestion(description: "How we shipped it."))
        )
        let result = await ops.createPost(siteID: "s1", title: "Launch Day", collection: nil, slug: nil)
        #expect(result == .created(filePath: "src/content/posts/launch-day.md", identifier: "launch-day"))
        let written = try String(contentsOf: root.appendingPathComponent("src/content/posts/launch-day.md"), encoding: .utf8)
        #expect(written.contains("description: \"How we shipped it.\""))
    }

    @Test("createPost honors a custom collection")
    func createPostCollection() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createPost(siteID: "s1", title: "Note one", collection: "notes", slug: nil)
        #expect(result == .created(filePath: "src/content/notes/note-one.md", identifier: "note-one"))
    }

    @Test("createPost rejects an unsafe collection name")
    func createPostBadCollection() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createPost(siteID: "s1", title: "X", collection: "../escape", slug: nil)
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("Invalid collection name"))
    }

    @Test("createTyped writes a like to its collection and commits")
    func createTypedLike() async throws {
        let (ops, root, spy) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "like", title: "Cool post", slug: nil,
            fieldValues: ["likeOf": "https://example.com/post"])
        #expect(result == .created(filePath: "src/content/likes/cool-post.md", identifier: "cool-post"))
        let written = try String(
            contentsOf: root.appendingPathComponent("src/content/likes/cool-post.md"), encoding: .utf8)
        #expect(written.contains("likeOf: \"https://example.com/post\""))
        #expect(written.contains("publishDate:"))
        let calls = await spy.calls
        #expect(calls.count == 1)
        #expect(calls.first?.1 == "src/content/likes/cool-post.md")
        #expect(calls.first?.2 == "anglesite: add likes cool-post")
    }

    @Test("createTyped rejects an unknown type")
    func createTypedUnknown() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createTyped(siteID: "s1", typeID: "nope", title: "x")
        #expect(result == .failed(reason: "Unknown content type: nope"))
    }

    @Test("createTyped rejects singleton types with a pointer to createTypedSingleton")
    func createTypedRejectsSingleton() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createTyped(siteID: "s1", typeID: "businessProfile", title: "x")
        #expect(result == .failed(reason: "businessProfile is not a collection type; use createTypedSingleton"))
    }

    @Test("createTyped refuses to write an entry missing a required .url value")
    func createTypedRejectsMissingRequiredURL() async {
        let (ops, root, spy) = makeOps()
        // The #916 regression guard: this is what the New Collection sheet used to do.
        let result = await ops.createTyped(siteID: "s1", typeID: "like", title: "Cool post", slug: nil)
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("likeOf"))
        #expect(!FileManager.default.fileExists(
            atPath: root.appendingPathComponent("src/content/likes/cool-post.md").path))
        let calls = await spy.calls
        #expect(calls.isEmpty)
    }

    @Test("createTyped refuses a required .url value that isn't an absolute URL")
    func createTypedRejectsMalformedRequiredURL() async {
        let (ops, root, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "bookmark", title: "Cool post", slug: nil,
            fieldValues: ["bookmarkOf": "example.com/post"])
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("bookmarkOf"))
        #expect(!FileManager.default.fileExists(
            atPath: root.appendingPathComponent("src/content/bookmarks/cool-post.md").path))
    }

    @Test("createTyped refuses a supplied optional .url value that isn't an absolute URL")
    func createTypedRejectsMalformedOptionalURL() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "note", title: "Hello", slug: nil,
            fieldValues: ["audience": "nope"])
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("audience"))
    }

    @Test("createTyped writes a bookmark with its target URL live in the frontmatter")
    func createTypedBookmarkWritesURL() async throws {
        let (ops, root, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "bookmark", title: "Cool post", slug: nil,
            fieldValues: ["bookmarkOf": "https://example.com/blog/hello-world"])
        #expect(result == .created(filePath: "src/content/bookmarks/cool-post.md", identifier: "cool-post"))
        let written = try String(
            contentsOf: root.appendingPathComponent("src/content/bookmarks/cool-post.md"), encoding: .utf8)
        #expect(written.contains("bookmarkOf: \"https://example.com/blog/hello-world\""))
        #expect(written.contains("title: \"Cool post\""))
    }

    @Test("createTyped persists a required URL trimmed, not the raw supplied value")
    func createTypedPersistsTrimmedRequiredURL() async throws {
        let (ops, root, _) = makeOps()
        // Surrounding whitespace (including a trailing newline) passes ContentFieldValidation's
        // trimmed check, but the raw value must never reach disk: escapeYAML doesn't escape
        // newlines, so persisting the untrimmed original would split the frontmatter (#916
        // follow-up). The written line must be exactly the clean, trimmed URL.
        let result = await ops.createTyped(
            siteID: "s1", typeID: "bookmark", title: "Cool post", slug: nil,
            fieldValues: ["bookmarkOf": "  https://example.com/post\n"])
        #expect(result == .created(filePath: "src/content/bookmarks/cool-post.md", identifier: "cool-post"))
        let written = try String(
            contentsOf: root.appendingPathComponent("src/content/bookmarks/cool-post.md"), encoding: .utf8)
        #expect(written.contains("bookmarkOf: \"https://example.com/post\"\n"))
    }

    @Test("a titleless type with no title derives its slug from the target URL")
    func createTypedDerivesSlugFromURL() async {
        let (ops, _, spy) = makeOps()   // now == 2025-06-15T15:06:40Z
        let result = await ops.createTyped(
            siteID: "s1", typeID: "reply", title: "", slug: nil,
            fieldValues: ["inReplyTo": "https://example.com/blog/hello-world"])
        #expect(result == .created(
            filePath: "src/content/replies/2025-06-15-example-com-hello-world.md",
            identifier: "2025-06-15-example-com-hello-world"))
        let calls = await spy.calls
        #expect(calls.first?.2 == "anglesite: add replies 2025-06-15-example-com-hello-world")
    }

    @Test("an explicit slug still beats both the title and the URL")
    func createTypedExplicitSlugWins() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "reply", title: "", slug: "my-reply",
            fieldValues: ["inReplyTo": "https://example.com/blog/hello-world"])
        #expect(result == .created(filePath: "src/content/replies/my-reply.md", identifier: "my-reply"))
    }

    @Test("createTypedSingleton writes the slot data file and commits")
    func createTypedSingletonWrites() async throws {
        let (ops, root, spy) = makeOps()
        let result = await ops.createTypedSingleton(siteID: "s1", typeID: "businessProfile", name: "Acme")
        #expect(result == .created(filePath: "src/data/profile.json", identifier: "profile"))
        let written = try String(
            contentsOf: root.appendingPathComponent("src/data/profile.json"), encoding: .utf8)
        #expect(written.contains("\"type\": \"businessProfile\""))
        #expect(written.contains("\"name\": \"Acme\""))
        let calls = await spy.calls
        #expect(calls.count == 1)
        #expect(calls.first?.1 == "src/data/profile.json")
        #expect(calls.first?.2 == "anglesite: add businessProfile")
    }

    @Test("createTypedSingleton enforces one identity per site across kinds")
    func createTypedSingletonMutuallyExclusive() async {
        let (ops, _, _) = makeOps()
        _ = await ops.createTypedSingleton(siteID: "s1", typeID: "businessProfile", name: "Acme")
        let second = await ops.createTypedSingleton(siteID: "s1", typeID: "personalProfile", name: "Ada")
        #expect(second == .failed(reason: "A site identity already exists at src/data/profile.json"))
    }

    @Test("createTypedSingleton rejects collection types and unknown ids")
    func createTypedSingletonRejectsCollection() async {
        let (ops, _, _) = makeOps()
        let coll = await ops.createTypedSingleton(siteID: "s1", typeID: "note", name: "x")
        #expect(coll == .failed(reason: "note is not a singleton type"))
        let unknown = await ops.createTypedSingleton(siteID: "s1", typeID: "nope", name: "x")
        #expect(unknown == .failed(reason: "Unknown content type: nope"))
    }

    @Test("processGitCommit returns a SHA in a real repo, nil outside one")
    func realGit() async throws {
        // Outside a repo → nil (best-effort).
        let bare = FileManager.default.temporaryDirectory.appendingPathComponent("nogit-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: bare, withIntermediateDirectories: true)
        try "hi".write(to: bare.appendingPathComponent("f.txt"), atomically: true, encoding: .utf8)
        let none = await NativeContentOperations.processGitCommit(bare, "f.txt", "msg")
        #expect(none == nil)

        // Inside a repo with an initial commit → a 40-char SHA.
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        for args in [["init"], ["config", "user.email", "t@t.io"], ["config", "user.name", "t"]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        try "page".write(to: repo.appendingPathComponent("p.astro"), atomically: true, encoding: .utf8)
        let sha = await NativeContentOperations.processGitCommit(repo, "p.astro", "anglesite: add page /p")
        #expect(sha?.count == 40)
    }

    @Test("processGitCommit falls back to the app identity when none is configured")
    func realGitNoIdentity() async throws {
        // #969: under App Sandbox `HOME` is redirected into the app's container, so the user's
        // ~/.gitconfig is invisible to libgit2 no matter how they configured git in Terminal.
        // `git_signature_default` then fails and every commit that treated that as fatal did
        // nothing at all. The commit must still land, attributed to the app.
        //
        // An *empty* repo-local user.name/user.email is the deterministic way to reproduce that
        // here: it fails `defaultSignature()` ("Signature cannot have an empty name or email")
        // even on a dev/CI machine that has a real ambient global identity, which a merely-absent
        // local identity would silently fall through to. (libgit2's config-search-path cache is
        // process-global and populated at the first SwiftGit2Init(), so mutating HOME/XDG mid-test
        // can't truncate the chain the way the sandbox does.)
        let repo = try await makeIdentitylessRepo(seeding: "p.astro", contents: "page")

        let sha = await NativeContentOperations.processGitCommit(repo, "p.astro", "anglesite: add page /p")
        #expect(sha?.count == 40)
        #expect(try await lastCommitAuthor(in: repo) == "Anglesite <noreply@anglesite.app>")
    }

    @Test("processGitCommit still returns nil on a corrupt repo config, rather than committing as the app")
    func realGitMalformedConfig() async throws {
        // The identity fallback must not swallow a *corrupt* repository. A config libgit2 can open
        // but not parse is a different thing from "this user never configured an identity", and it
        // shouldn't quietly land a commit attributed to Anglesite in a repo that's structurally
        // broken.
        //
        // It doesn't, but not via the fallback: an unparseable config fails `Repository.at`
        // (`git_repository_open` reads config as part of opening), so the guard at the top of
        // `processGitCommit` returns nil before identity resolution is ever reached. This test
        // exists to pin that ordering — it's what keeps `GitIdentity`'s "any `defaultSignature()`
        // failure ⇒ substitute" rule from widening into "any broken repo ⇒ commit anyway"
        // (PR #983 review). It's the surviving half of the pre-#983 `realGitNoIdentity` test, whose
        // other assertion (a missing identity ⇒ nil) is the behavior #969 fixed.
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        _ = try await ProcessSupervisor.shared.run(executable: git, arguments: ["init"], currentDirectoryURL: repo)
        try "[core\nthis is not valid git-config syntax".write(
            to: repo.appendingPathComponent(".git/config"), atomically: true, encoding: .utf8)
        try "page".write(to: repo.appendingPathComponent("p.astro"), atomically: true, encoding: .utf8)

        let sha = await NativeContentOperations.processGitCommit(repo, "p.astro", "anglesite: add page /p")
        #expect(sha == nil)
    }

    @Test("processGitCommit prefers a configured identity over the app fallback")
    func realGitPrefersConfiguredIdentity() async throws {
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        for args in [["init"], ["config", "user.email", "t@t.io"], ["config", "user.name", "t"]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        try "page".write(to: repo.appendingPathComponent("p.astro"), atomically: true, encoding: .utf8)

        let sha = await NativeContentOperations.processGitCommit(repo, "p.astro", "anglesite: add page /p")
        #expect(sha?.count == 40)
        #expect(try await lastCommitAuthor(in: repo) == "t <t@t.io>")
    }

    @Test("processGitDelete deletes and commits when no git identity is configured")
    func realGitDeleteNoIdentity() async throws {
        // The #969 headline symptom: on a sandboxed build the delete removed the file, failed to
        // commit for want of an identity, rolled back, and reported nothing — so Delete read as
        // "I clicked it and nothing happened". It must complete instead.
        let repo = try await makeIdentitylessRepo(seeding: "unused.astro", contents: "<div></div>", commitSeed: true)
        let filePath = repo.appendingPathComponent("unused.astro")

        let sha = await NativeContentOperations.processGitDelete(repo, "unused.astro", "Remove unused.astro")
        #expect(sha?.count == 40)
        #expect(!FileManager.default.fileExists(atPath: filePath.path))
        #expect(try await lastCommitAuthor(in: repo) == "Anglesite <noreply@anglesite.app>")
    }

    /// A repo whose local `user.name`/`user.email` are set to the empty string — the deterministic
    /// `defaultSignature()` failure described in `realGitNoIdentity`. Seeded (and optionally
    /// committed) *before* the identity is blanked, so `HEAD` can still contain the file.
    private func makeIdentitylessRepo(
        seeding relPath: String, contents: String, commitSeed: Bool = false
    ) async throws -> URL {
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        for args in [["init"], ["config", "user.email", "seed@t.io"], ["config", "user.name", "seed"]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        try contents.write(to: repo.appendingPathComponent(relPath), atomically: true, encoding: .utf8)
        if commitSeed {
            _ = await NativeContentOperations.processGitCommit(repo, relPath, "add \(relPath)")
        }
        for args in [["config", "user.email", ""], ["config", "user.name", ""]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        return repo
    }

    private func lastCommitAuthor(in repo: URL) async throws -> String {
        let result = try await ProcessSupervisor.shared.run(
            executable: URL(fileURLWithPath: "/usr/bin/git"),
            arguments: ["log", "-1", "--format=%an <%ae>"], currentDirectoryURL: repo)
        return result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @Test("processGitDelete removes and commits the file, nil outside a repo")
    func realGitDelete() async throws {
        // Outside a repo → nil (best-effort), file untouched.
        let bare = FileManager.default.temporaryDirectory.appendingPathComponent("nogit-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: bare, withIntermediateDirectories: true)
        try "hi".write(to: bare.appendingPathComponent("f.txt"), atomically: true, encoding: .utf8)
        let none = await NativeContentOperations.processGitDelete(bare, "f.txt", "msg")
        #expect(none == nil)
        #expect(FileManager.default.fileExists(atPath: bare.appendingPathComponent("f.txt").path))

        // Inside a repo with a committed file → delete succeeds, returns a 40-char SHA, file gone.
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        for args in [["init"], ["config", "user.email", "t@t.io"], ["config", "user.name", "t"]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        let filePath = repo.appendingPathComponent("unused.astro")
        try "<div></div>".write(to: filePath, atomically: true, encoding: .utf8)
        _ = await NativeContentOperations.processGitCommit(repo, "unused.astro", "add unused.astro")

        let sha = await NativeContentOperations.processGitDelete(repo, "unused.astro", "Remove unused component: unused.astro")
        #expect(sha?.count == 40)
        #expect(!FileManager.default.fileExists(atPath: filePath.path))
    }

    @Test("processGitDelete restores the file from HEAD when commit fails after rm succeeds")
    func rollbackOnCommitFailure() async throws {
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        for args in [["init"], ["config", "user.email", "t@t.io"], ["config", "user.name", "t"]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        let filePath = repo.appendingPathComponent("unused.astro")
        try "<div>original</div>".write(to: filePath, atomically: true, encoding: .utf8)
        _ = await NativeContentOperations.processGitCommit(repo, "unused.astro", "add unused.astro")

        // Force the commit step to fail after the remove already succeeds: make the object
        // database unwritable, so writing the new tree/commit objects fails. This used to be a
        // rejecting `.git/hooks/pre-commit` hook, but SwiftGit2/libgit2 never runs shell hooks —
        // a documented, accepted difference from the subprocess-git implementation this replaced
        // (see processGitCommit's doc comment) — so a hook no longer exercises this path at all.
        // Read access is untouched (0o555), so the rollback's restore-from-HEAD (which only reads
        // existing objects, not writes new ones) still works.
        let objectsDir = repo.appendingPathComponent(".git/objects")
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: objectsDir.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: objectsDir.path) }

        let sha = await NativeContentOperations.processGitDelete(repo, "unused.astro", "Remove unused.astro")
        #expect(sha == nil)
        #expect(FileManager.default.fileExists(atPath: filePath.path))
        #expect(try String(contentsOf: filePath, encoding: .utf8) == "<div>original</div>")

        let status = try await ProcessSupervisor.shared.run(executable: git, arguments: ["status", "--porcelain"], currentDirectoryURL: repo)
        #expect(status.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    @Test("hasCommit finds an exact commit-message match in a real repo, and doesn't substring-match a shorter message")
    func realGitHasCommit() async throws {
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        for args in [["init"], ["config", "user.email", "t@t.io"], ["config", "user.name", "t"]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        // Commit message is a superstring of the shorter message we'll also search for below —
        // this is the exact false-positive risk the review flagged: `git log --grep` substring-
        // matches by default, so a naive implementation would incorrectly report the shorter
        // message as found too.
        try "note".write(to: repo.appendingPathComponent("my-note-extra.md"), atomically: true, encoding: .utf8)
        _ = await NativeContentOperations.processGitCommit(repo, "my-note-extra.md", "anglesite: publish note my-note-extra")

        let found = await NativeContentOperations.hasCommit(repo, "anglesite: publish note my-note-extra")
        #expect(found == true)

        let notFound = await NativeContentOperations.hasCommit(repo, "anglesite: publish note my-note")
        #expect(notFound == false)
    }

    @Test("processGitDelete refuses a staged-but-never-committed file (no HEAD copy to roll back to)")
    func refusesUncommittedFile() async throws {
        let repo = FileManager.default.temporaryDirectory.appendingPathComponent("git-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        let git = URL(fileURLWithPath: "/usr/bin/git")
        for args in [["init"], ["config", "user.email", "t@t.io"], ["config", "user.name", "t"]] {
            _ = try await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: repo)
        }
        // A first commit so the repo has a HEAD at all.
        try "root".write(to: repo.appendingPathComponent("root.txt"), atomically: true, encoding: .utf8)
        _ = await NativeContentOperations.processGitCommit(repo, "root.txt", "initial")

        // Staged via `git add`, but never committed.
        let filePath = repo.appendingPathComponent("staged-only.astro")
        try "<div></div>".write(to: filePath, atomically: true, encoding: .utf8)
        _ = try await ProcessSupervisor.shared.run(executable: git, arguments: ["add", "staged-only.astro"], currentDirectoryURL: repo)

        let sha = await NativeContentOperations.processGitDelete(repo, "staged-only.astro", "Remove staged-only.astro")
        #expect(sha == nil)
        #expect(FileManager.default.fileExists(atPath: filePath.path))
    }

    private func makePublishOps(
        publishedBefore: Bool = false,
        now: Date = Date(timeIntervalSince1970: 1_750_000_000)
    ) -> (ops: NativeContentOperations, root: URL, calls: Spy) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let spy = Spy()
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { proj, rel, msg in await spy.record(proj, rel, msg); return "deadbeef" },
            gitHasCommit: { _, _ in publishedBefore },
            now: { now }
        )
        return (ops, root, spy)
    }

    @Test("publish sets draft: false and re-stamps publishDate on a first publish")
    func publishFirstTime() async throws {
        let (ops, root, spy) = makePublishOps(publishedBefore: false)
        let dir = root.appendingPathComponent("src/content/notes", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("my-note.md")
        try """
        ---
        publishDate: 2020-01-01T00:00:00.000Z
        tags: []
        draft: true
        ---

        Hello.
        """.write(to: file, atomically: true, encoding: .utf8)

        let result = await ops.publish(siteID: "s1", relativePath: "src/content/notes/my-note.md", collection: "notes")
        #expect(result == .created(filePath: "src/content/notes/my-note.md", identifier: "my-note"))

        let written = try String(contentsOf: file, encoding: .utf8)
        #expect(written.contains("draft: false"))
        #expect(written.contains("publishDate: 2025-06-15T15:06:40.000Z")) // re-stamped to `now`
        #expect(!written.contains("2020-01-01"))

        let calls = await spy.calls
        #expect(calls.count == 1)
        #expect(calls.first?.2 == "anglesite: publish note my-note")
    }

    @Test("publish keeps the original publishDate on a republish")
    func publishRepublish() async throws {
        let (ops, root, spy) = makePublishOps(publishedBefore: true)
        let dir = root.appendingPathComponent("src/content/notes", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("my-note.md")
        try """
        ---
        publishDate: 2020-01-01T00:00:00.000Z
        tags: []
        draft: true
        ---

        Hello.
        """.write(to: file, atomically: true, encoding: .utf8)

        let result = await ops.publish(siteID: "s1", relativePath: "src/content/notes/my-note.md", collection: "notes")
        #expect(result == .created(filePath: "src/content/notes/my-note.md", identifier: "my-note"))

        let written = try String(contentsOf: file, encoding: .utf8)
        #expect(written.contains("draft: false"))
        #expect(written.contains("publishDate: 2020-01-01T00:00:00.000Z")) // untouched

        let calls = await spy.calls
        #expect(calls.first?.2 == "anglesite: publish note my-note")
    }

    @Test("unpublish sets draft: true and leaves publishDate untouched")
    func unpublish() async throws {
        let (ops, root, spy) = makePublishOps()
        let dir = root.appendingPathComponent("src/content/notes", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("my-note.md")
        try """
        ---
        publishDate: 2025-06-15T15:06:40.000Z
        tags: []
        draft: false
        ---

        Hello.
        """.write(to: file, atomically: true, encoding: .utf8)

        let result = await ops.unpublish(siteID: "s1", relativePath: "src/content/notes/my-note.md", collection: "notes")
        #expect(result == .created(filePath: "src/content/notes/my-note.md", identifier: "my-note"))

        let written = try String(contentsOf: file, encoding: .utf8)
        #expect(written.contains("draft: true"))
        #expect(written.contains("publishDate: 2025-06-15T15:06:40.000Z"))

        let calls = await spy.calls
        #expect(calls.first?.2 == "anglesite: unpublish note my-note")
    }

    @Test("publish reports .failed for an unregistered collection")
    func publishUnknownCollection() async {
        let (ops, _, _) = makePublishOps()
        let result = await ops.publish(siteID: "s1", relativePath: "src/content/blog/hello.md", collection: "blog")
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("blog"))
    }

    @Test("publish reports .failed for a registered collection with no draft field, instead of silently no-opping")
    func publishDraftlessCollection() async {
        let (ops, _, _) = makePublishOps()
        let result = await ops.publish(siteID: "s1", relativePath: "src/content/events/party.md", collection: "events")
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("events"))
    }
}

@Suite("NativeContentOperations.deleteContent")
struct NativeContentOperationsDeleteTests {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-ops-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @Test("deletes an existing file via the injected gitDelete closure")
    func deletesExistingFile() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/pages/about.astro"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("stub".utf8).write(to: abs)

        var deletedArgs: (URL, String, String)?
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitDelete: { projectRoot, path, message in
                deletedArgs = (projectRoot, path, message)
                return "deadbeef"
            }
        )

        let result = await ops.deleteContent(siteID: "site-1", relativePath: relPath)

        #expect(result == .deleted(filePath: relPath))
        #expect(deletedArgs?.0 == root)
        #expect(deletedArgs?.1 == relPath)
    }

    @Test("fails when the file does not exist")
    func failsWhenMissing() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitDelete: { _, _, _ in "deadbeef" }
        )

        let result = await ops.deleteContent(siteID: "site-1", relativePath: "src/pages/missing.astro")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }

    @Test("fails when gitDelete refuses (dirty tree, no HEAD copy, etc.)")
    func failsWhenGitDeleteRefuses() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/pages/about.astro"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("stub".utf8).write(to: abs)
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitDelete: { _, _, _ in nil }
        )

        let result = await ops.deleteContent(siteID: "site-1", relativePath: relPath)

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }

    @Test("reports siteNotFound when siteDirectory resolves nil")
    func siteNotFound() async {
        let ops = NativeContentOperations(
            siteDirectory: { _ in nil },
            gitDelete: { _, _, _ in "deadbeef" }
        )

        let result = await ops.deleteContent(siteID: "missing-site", relativePath: "src/pages/about.astro")

        #expect(result == .siteNotFound)
    }

    @Test("restoreContent writes the given contents back and commits via the injected closure")
    func restoresContent() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/pages/about.astro"

        var committedArgs: (URL, String, String)?
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { projectRoot, path, message in
                committedArgs = (projectRoot, path, message)
                return "deadbeef"
            }
        )

        let result = await ops.restoreContent(siteID: "site-1", relativePath: relPath, contents: "restored body")

        #expect(result == .created(filePath: relPath, identifier: relPath))
        let written = try String(contentsOf: root.appendingPathComponent(relPath), encoding: .utf8)
        #expect(written == "restored body")
        #expect(committedArgs?.1 == relPath)
    }

    @Test("restoreContent reports .failed when the recommit fails, even though the write itself landed")
    func restoreContentFailsWhenCommitFails() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/pages/about.astro"
        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { _, _, _ in nil }
        )

        let result = await ops.restoreContent(siteID: "site-1", relativePath: relPath, contents: "restored body")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
        // The write itself is not rolled back on a commit failure — the caller (SiteWindowModel)
        // relies on this to decide whether to reopen the editor/inspector on the restored file.
        let written = try String(contentsOf: root.appendingPathComponent(relPath), encoding: .utf8)
        #expect(written == "restored body")
    }

    @Test("restoreContent reports siteNotFound when siteDirectory resolves nil")
    func restoreContentSiteNotFound() async {
        let ops = NativeContentOperations(
            siteDirectory: { _ in nil },
            gitCommit: { _, _, _ in "deadbeef" }
        )

        let result = await ops.restoreContent(siteID: "missing-site", relativePath: "src/pages/about.astro", contents: "x")

        #expect(result == .siteNotFound)
    }
}

@Suite("NativeContentOperations.duplicatePage/duplicatePost")
struct NativeContentOperationsDuplicateTests {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-ops-dup-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @Test("duplicatePage writes a -copy suffixed file with the retitled contents")
    func duplicatesPage() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/pages/about.astro"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = ContentScaffold.renderPage(title: "About", layoutImport: "../layouts/BaseLayout.astro")
        try original.write(to: abs, atomically: true, encoding: .utf8)

        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { _, _, _ in "deadbeef" }
        )

        let result = await ops.duplicatePage(siteID: "site-1", relativePath: relPath, title: "About")

        guard case .created(let filePath, let identifier) = result else {
            Issue.record("expected .created, got \(result)"); return
        }
        #expect(filePath == "src/pages/about-copy.astro")
        #expect(identifier == "/about-copy")
        let copied = try String(contentsOf: root.appendingPathComponent(filePath), encoding: .utf8)
        #expect(copied.contains("title=\"About Copy\""))
    }

    @Test("duplicatePage bumps the suffix on collision")
    func duplicatesPageWithCollision() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/pages/about.astro"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        try ContentScaffold.renderPage(title: "About", layoutImport: "../layouts/BaseLayout.astro")
            .write(to: abs, atomically: true, encoding: .utf8)
        try ContentScaffold.renderPage(title: "About Copy", layoutImport: "../layouts/BaseLayout.astro")
            .write(to: root.appendingPathComponent("src/pages/about-copy.astro"), atomically: true, encoding: .utf8)

        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { _, _, _ in "deadbeef" }
        )

        let result = await ops.duplicatePage(siteID: "site-1", relativePath: relPath, title: "About")

        guard case .created(let filePath, _) = result else { Issue.record("expected .created, got \(result)"); return }
        #expect(filePath == "src/pages/about-copy-2.astro")
    }

    @Test("duplicatePost writes into the same collection with a -copy slug")
    func duplicatesPost() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/content/posts/hello-world.md"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        try ContentScaffold.renderPost(title: "Hello World", now: Date(timeIntervalSince1970: 0))
            .write(to: abs, atomically: true, encoding: .utf8)

        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { _, _, _ in "deadbeef" }
        )

        let result = await ops.duplicatePost(siteID: "site-1", relativePath: relPath, collection: "posts", title: "Hello World")

        guard case .created(let filePath, let identifier) = result else {
            Issue.record("expected .created, got \(result)"); return
        }
        #expect(filePath == "src/content/posts/hello-world-copy.md")
        #expect(identifier == "hello-world-copy")
        let copied = try String(contentsOf: root.appendingPathComponent(filePath), encoding: .utf8)
        #expect(copied.contains("title: \"Hello World Copy\""))
    }

    @Test("duplicatePage falls back to a verbatim copy when the extension has no editable title location")
    func duplicatesPageWithUnrecognizedExtensionVerbatim() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/pages/notes.txt"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = "Just some plain notes.\nNo frontmatter, no title attribute.\n"
        try original.write(to: abs, atomically: true, encoding: .utf8)

        let ops = NativeContentOperations(
            siteDirectory: { _ in root },
            gitCommit: { _, _, _ in "deadbeef" }
        )

        let result = await ops.duplicatePage(siteID: "site-1", relativePath: relPath, title: "Notes")

        guard case .created(let filePath, _) = result else {
            Issue.record("expected .created, got \(result)"); return
        }
        let copied = try String(contentsOf: root.appendingPathComponent(filePath), encoding: .utf8)
        #expect(copied == original)
    }

    @Test("duplicatePage fails when the source file does not exist")
    func duplicateMissingSourceFails() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ops = NativeContentOperations(siteDirectory: { _ in root })

        let result = await ops.duplicatePage(siteID: "site-1", relativePath: "src/pages/missing.astro", title: "Missing")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }
}

@Suite("NativeContentOperations.createComponent")
struct NativeContentOperationsComponentTests {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-ops-component-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @Test("creates a PascalCase-named blank component")
    func createsComponent() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ops = NativeContentOperations(siteDirectory: { _ in root }, gitCommit: { _, _, _ in "deadbeef" })

        let result = await ops.createComponent(siteID: "site-1", name: "call to action")

        guard case .created(let filePath, let identifier) = result else {
            Issue.record("expected .created, got \(result)"); return
        }
        #expect(filePath == "src/components/CallToAction.astro")
        #expect(identifier == "CallToAction")
        #expect(FileManager.default.fileExists(atPath: root.appendingPathComponent(filePath).path))
    }

    @Test("fails when a component already exists at that path")
    func failsOnCollision() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let existing = root.appendingPathComponent("src/components/CallToAction.astro")
        try FileManager.default.createDirectory(at: existing.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("stub".utf8).write(to: existing)
        let ops = NativeContentOperations(siteDirectory: { _ in root })

        let result = await ops.createComponent(siteID: "site-1", name: "Call To Action")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }

    @Test("fails on an empty name")
    func failsOnEmptyName() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ops = NativeContentOperations(siteDirectory: { _ in root })

        let result = await ops.createComponent(siteID: "site-1", name: "   ")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }
}

@Suite("NativeContentOperations.duplicateComponent")
struct NativeContentOperationsDuplicateComponentTests {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("native-content-ops-dup-component-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @Test("duplicateComponent writes a Copy-suffixed file with identical contents")
    func duplicatesComponent() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/components/Card.astro"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = "---\ninterface Props { title: string }\n---\n<div>{Astro.props.title}</div>\n"
        try original.write(to: abs, atomically: true, encoding: .utf8)

        let ops = NativeContentOperations(siteDirectory: { _ in root }, gitCommit: { _, _, _ in "deadbeef" })

        let result = await ops.duplicateComponent(siteID: "site-1", relativePath: relPath)

        guard case .created(let filePath, let identifier) = result else {
            Issue.record("expected .created, got \(result)"); return
        }
        #expect(filePath == "src/components/CardCopy.astro")
        #expect(identifier == "CardCopy")
        let copied = try String(contentsOf: root.appendingPathComponent(filePath), encoding: .utf8)
        #expect(copied == original)
    }

    @Test("duplicateComponent bumps the suffix on collision")
    func duplicatesComponentWithCollision() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/components/Card.astro"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "original".write(to: abs, atomically: true, encoding: .utf8)
        try "existing copy".write(to: root.appendingPathComponent("src/components/CardCopy.astro"), atomically: true, encoding: .utf8)

        let ops = NativeContentOperations(siteDirectory: { _ in root }, gitCommit: { _, _, _ in "deadbeef" })

        let result = await ops.duplicateComponent(siteID: "site-1", relativePath: relPath)

        guard case .created(let filePath, let identifier) = result else {
            Issue.record("expected .created, got \(result)"); return
        }
        #expect(filePath == "src/components/CardCopy2.astro")
        #expect(identifier == "CardCopy2")
    }

    @Test("duplicateComponent preserves a nested subdirectory")
    func duplicatesNestedComponent() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let relPath = "src/components/esi/EsiInclude.astro"
        let abs = root.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "original".write(to: abs, atomically: true, encoding: .utf8)

        let ops = NativeContentOperations(siteDirectory: { _ in root }, gitCommit: { _, _, _ in "deadbeef" })

        let result = await ops.duplicateComponent(siteID: "site-1", relativePath: relPath)

        guard case .created(let filePath, _) = result else { Issue.record("expected .created, got \(result)"); return }
        #expect(filePath == "src/components/esi/EsiIncludeCopy.astro")
    }

    @Test("duplicateComponent fails when the source file does not exist")
    func duplicateMissingComponentFails() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ops = NativeContentOperations(siteDirectory: { _ in root })

        let result = await ops.duplicateComponent(siteID: "site-1", relativePath: "src/components/Missing.astro")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }

    @Test("unknown site returns .siteNotFound")
    func duplicateComponentSiteNotFound() async {
        let ops = NativeContentOperations(siteDirectory: { _ in nil }, gitCommit: { _, _, _ in nil })
        let result = await ops.duplicateComponent(siteID: "missing", relativePath: "src/components/Card.astro")
        #expect(result == .siteNotFound)
    }
}

private struct StubPageCopyGenerator: PageCopyGenerating {
    let suggestion: PageCopySuggestion?
    func suggestDescription(title: String, siteID: String, siteDirectory: URL) async -> PageCopySuggestion? {
        suggestion
    }
}
