import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

/// Render half of V-3.4 (#362): a `ReceivedInteraction` snapshot written to its `gitPath`
/// renders under the target post at build time, and non-verified snapshots do not.
/// Round-trips the actual Swift contract — `ReceivedInteraction` → JSONEncoder → the
/// template's zod loader — so a schema drift on either side fails here.
@Suite("Interactions render smoke")
struct InteractionsRenderSmokeTests {

    /// Repo-root-relative path to the committed template. `swift test` runs with CWD = package root.
    static var templateDir: URL { get throws { try templateRoot() } }

    /// True when the template can actually be built: a Node binary plus an installed Astro.
    static var buildable: Bool { ((try? templateDir).map { E2EPrerequisites.astroBuildable(templateDir: $0) }) ?? false }

    private static func fixture(
        id: String,
        interactionType: ReceivedInteraction.InteractionType,
        content: String?,
        verificationStatus: ReceivedInteraction.VerificationStatus
    ) throws -> ReceivedInteraction {
        try ReceivedInteraction(
            id: id,
            type: .webmention,
            source: URL(string: "https://other.example/post/42")!,
            target: URL(string: "https://example.com/blog/welcome-to-your-blog/")!,
            interactionType: interactionType,
            author: .init(name: "Jane Doe", url: URL(string: "https://other.example"), photo: nil),
            content: content,
            published: Date(timeIntervalSince1970: 1_782_000_000),
            verified: Date(timeIntervalSince1970: 1_782_000_300),
            verificationStatus: verificationStatus)
    }

    @Test("a verified reply snapshot renders under the target post; non-verified does not",
          .enabled(if: InteractionsRenderSmokeTests.buildable))
    func rendersVerifiedReply() async throws {
        let node = try #require(E2EPrerequisites.locateNode())
        let templateDir = try Self.templateDir
        let dist = templateDir.appendingPathComponent("dist", isDirectory: true)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601

        let verified = try Self.fixture(
            id: "wm-swiftsmoke-reply", interactionType: .reply,
            content: "A verified reply from the Swift smoke test.", verificationStatus: .verified)
        let pending = try Self.fixture(
            id: "wm-swiftsmoke-pending", interactionType: .reply,
            content: "A pending reply that must not render.", verificationStatus: .pending)
        let fixtureURLs = try [verified, pending].map { interaction -> URL in
            let url = templateDir.appendingPathComponent(interaction.gitPath)
            try encoder.encode(interaction).write(to: url)
            return url
        }

        // Hold the shared template-build lock across the build *and* the assertions — sibling
        // render-smoke suites rebuild the same template tree (see PersonalTypeRenderSmokeTests).
        try await TemplateBuildSerializer.shared.serialize {
            try? FileManager.default.removeItem(at: dist)
            defer {
                try? FileManager.default.removeItem(at: dist)
                for url in fixtureURLs { try? FileManager.default.removeItem(at: url) }
            }

            let result = try await ProcessSupervisor.shared.run(
                executable: node,
                arguments: [E2EPrerequisites.astroCLIRelativePath, "build"],
                currentDirectoryURL: templateDir)
            try #require(result.exitCode == 0, "astro build failed: \(result.stdout)\n\(result.stderr)")

            let postHTML = try String(
                contentsOf: dist.appendingPathComponent("blog/welcome-to-your-blog/index.html"),
                encoding: .utf8)
            #expect(postHTML.contains("p-comment h-cite"))
            #expect(postHTML.contains("A verified reply from the Swift smoke test."))
            #expect(postHTML.contains("Jane Doe"))
            #expect(!postHTML.contains("A pending reply that must not render."))
        }
    }
}
