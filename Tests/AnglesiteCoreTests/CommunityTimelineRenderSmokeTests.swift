import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

/// Render half of V-5.2b (#908): an `AnnouncedPost` snapshot written to its `gitPath` renders on
/// the community timeline at build time. Round-trips the actual Swift contract —
/// `AnnouncedPost` → JSONEncoder → the template's zod loader — so a schema drift on either side
/// fails here.
///
/// There is no real page mounting `CommunityTimeline.astro` yet — the actual timeline page ships
/// with #907's group-preset scope ("Timeline page ships in the 5.1b group preset"). So this test
/// writes a temporary fixture page alongside the data fixtures, purely to exercise the render
/// pipeline end to end; it is never committed as template content.
///
/// `.serialized`: both tests below write to the *same* fixture-page path (there's only one
/// component to mount), so they must not run concurrently against each other — on top of the
/// cross-suite `TemplateBuildSerializer` lock the build/assertions already hold.
@Suite("Community timeline render smoke", .serialized)
struct CommunityTimelineRenderSmokeTests {

    /// Repo-root-relative path to the committed template. `swift test` runs with CWD = package root.
    static var templateDir: URL { get throws { try templateRoot() } }

    /// True when the template can actually be built: a Node binary plus an installed Astro.
    static var buildable: Bool { ((try? templateDir).map { E2EPrerequisites.astroBuildable(templateDir: $0) }) ?? false }

    private static let fixturePageMarkup = """
    ---
    import BaseLayout from "../layouts/BaseLayout.astro";
    import CommunityTimeline from "../components/CommunityTimeline.astro";
    ---

    <BaseLayout title="Community timeline smoke fixture" description="Render-smoke fixture for #908, never shipped.">
      <CommunityTimeline />
    </BaseLayout>
    """

    private static func fixture(
        id: String,
        objectType: AnnouncedPost.ObjectType,
        content: String?
    ) throws -> AnnouncedPost {
        try AnnouncedPost(
            id: id,
            objectType: objectType,
            sourceURL: URL(string: "https://member.example/posts/42")!,
            author: .init(name: "Jane Doe", url: URL(string: "https://member.example"), photo: nil),
            content: content,
            published: Date(timeIntervalSince1970: 1_782_000_000),
            announcedAt: Date(timeIntervalSince1970: 1_782_000_300))
    }

    @Test("an announced post snapshot renders on the community timeline",
          .enabled(if: CommunityTimelineRenderSmokeTests.buildable))
    func rendersAnnouncedPost() async throws {
        let node = try #require(E2EPrerequisites.locateNode())
        let templateDir = try Self.templateDir
        let dist = templateDir.appendingPathComponent("dist", isDirectory: true)
        let fixturePage = templateDir.appendingPathComponent("src/pages/community-timeline-smoke-fixture.astro")
        let postFixture = templateDir.appendingPathComponent(
            (try Self.fixture(id: "community-swiftsmoke", objectType: .note, content: nil)).gitPath)

        // Hold the shared template-build lock across fixture setup, the build, *and* the
        // assertions — sibling render-smoke suites rebuild the same template tree (see
        // PersonalTypeRenderSmokeTests), and this suite's own two tests share one fixture page.
        try await TemplateBuildSerializer.shared.serialize {
            try? FileManager.default.removeItem(at: dist)
            defer {
                try? FileManager.default.removeItem(at: dist)
                try? FileManager.default.removeItem(at: postFixture)
                try? FileManager.default.removeItem(at: fixturePage)
            }

            let post = try Self.fixture(id: "community-swiftsmoke", objectType: .note, content: "A verified post from the Swift smoke test.")
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            try FileManager.default.createDirectory(at: postFixture.deletingLastPathComponent(), withIntermediateDirectories: true)
            try encoder.encode(post).write(to: postFixture)
            try Self.fixturePageMarkup.write(to: fixturePage, atomically: true, encoding: .utf8)

            let result = try await ProcessSupervisor.shared.run(
                executable: node,
                arguments: [E2EPrerequisites.astroCLIRelativePath, "build"],
                currentDirectoryURL: templateDir)
            try #require(result.exitCode == 0, "astro build failed: \(result.stdout)\n\(result.stderr)")

            let pageHTML = try String(
                contentsOf: dist.appendingPathComponent("community-timeline-smoke-fixture/index.html"),
                encoding: .utf8)
            #expect(pageHTML.contains("h-entry community-post"))
            #expect(pageHTML.contains("A verified post from the Swift smoke test."))
            #expect(pageHTML.contains("Jane Doe"))
        }
    }

    @Test("a post with an invalid path-traversal id is skipped, not built",
          .enabled(if: CommunityTimelineRenderSmokeTests.buildable))
    func skipsMalformedSnapshot() async throws {
        let node = try #require(E2EPrerequisites.locateNode())
        let templateDir = try Self.templateDir
        let dist = templateDir.appendingPathComponent("dist", isDirectory: true)
        let fixturePage = templateDir.appendingPathComponent("src/pages/community-timeline-smoke-fixture.astro")
        let malformedURL = templateDir.appendingPathComponent("data/community-posts/malformed.json")

        try await TemplateBuildSerializer.shared.serialize {
            try? FileManager.default.removeItem(at: dist)
            defer {
                try? FileManager.default.removeItem(at: dist)
                try? FileManager.default.removeItem(at: malformedURL)
                try? FileManager.default.removeItem(at: fixturePage)
            }

            try FileManager.default.createDirectory(at: malformedURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            // Written directly (not through AnnouncedPost's own path-traversal guard) since this
            // fixture simulates a malformed file reaching the template layer some other way.
            try Data("""
            {"id": "not valid!", "objectType": "note", "sourceURL": "https://member.example/x",
             "published": "2026-06-28T14:30:00Z", "announcedAt": "2026-06-28T14:30:05Z"}
            """.utf8).write(to: malformedURL)
            try Self.fixturePageMarkup.write(to: fixturePage, atomically: true, encoding: .utf8)

            let result = try await ProcessSupervisor.shared.run(
                executable: node,
                arguments: [E2EPrerequisites.astroCLIRelativePath, "build"],
                currentDirectoryURL: templateDir)
            try #require(result.exitCode == 0, "astro build failed: \(result.stdout)\n\(result.stderr)")

            let pageHTML = try String(
                contentsOf: dist.appendingPathComponent("community-timeline-smoke-fixture/index.html"),
                encoding: .utf8)
            #expect(!pageHTML.contains("h-entry community-post"))
        }
    }
}
