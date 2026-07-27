import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ActivityPubActor")
struct ActivityPubActorTests {
    @Test("builds the actor and followers collection URLs")
    func buildsURLs() throws {
        let site = try #require(URL(string: "https://example.com"))
        #expect(ActivityPubActor.actorURL(siteURL: site).absoluteString
            == "https://example.com/users/site")
        #expect(ActivityPubActor.followersURL(siteURL: site).absoluteString
            == "https://example.com/users/site/followers")
    }

    /// The app hardcodes `/users/site` to reach a collection the template's Worker serves. If the
    /// template ever renames `ACTIVITYPUB_USERNAME`, the Followers pane would silently 404 — this
    /// is the guard that turns that into a build failure instead.
    @Test("matches ACTIVITYPUB_USERNAME in the template worker")
    func matchesTemplateConstant() throws {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let workerURL = repoRoot.appendingPathComponent("Resources/Template/worker/worker.ts")
        let source = try String(contentsOf: workerURL, encoding: .utf8)
        #expect(source.contains("const ACTIVITYPUB_USERNAME = \"\(ActivityPubActor.username)\";"))
    }
}
