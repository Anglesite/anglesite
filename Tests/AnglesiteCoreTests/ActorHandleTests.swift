import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ActorHandle")
struct ActorHandleTests {
    @Test("derives a handle from a Mastodon /users/ actor IRI")
    func derivesFromUsersPath() throws {
        let actor = try #require(URL(string: "https://mastodon.social/users/alice"))
        #expect(ActorHandle.derive(from: actor) == "@alice@mastodon.social")
    }

    @Test("derives a handle from an /@name actor IRI")
    func derivesFromAtPath() throws {
        let actor = try #require(URL(string: "https://example.social/@bob"))
        #expect(ActorHandle.derive(from: actor) == "@bob@example.social")
    }

    @Test("derives a handle from a Lemmy community IRI")
    func derivesFromLemmyCommunity() throws {
        let actor = try #require(URL(string: "https://lemmy.world/c/technology"))
        #expect(ActorHandle.derive(from: actor) == "@technology@lemmy.world")
    }

    @Test("returns nil for an unfamiliar path shape rather than inventing a handle")
    func returnsNilForUnfamiliarPath() throws {
        let actor = try #require(
            URL(string: "https://example.com/ap/actor/550e8400-e29b-41d4-a716-446655440000"))
        #expect(ActorHandle.derive(from: actor) == nil)
    }

    @Test("returns nil when the IRI has no path segments")
    func returnsNilForBareHost() throws {
        let actor = try #require(URL(string: "https://example.com"))
        #expect(ActorHandle.derive(from: actor) == nil)
    }

    @Test("derives a handle from a Lemmy user IRI")
    func derivesFromLemmyUser() throws {
        let actor = try #require(URL(string: "https://lemmy.world/u/dave"))
        #expect(ActorHandle.derive(from: actor) == "@dave@lemmy.world")
    }

    @Test("strips a bidi override character from the derived handle")
    func stripsBidiOverrideFromName() throws {
        // U+202E RIGHT-TO-LEFT OVERRIDE embedded in the name segment: URL.pathComponents
        // percent-decodes, so a malicious server can serve this in an actor IRI to make the
        // handle render misleadingly (impersonation vector). It must not survive into the
        // returned handle.
        let actor = try #require(URL(string: "https://mastodon.social/users/alice%E2%80%AEevil"))
        #expect(ActorHandle.derive(from: actor) == "@aliceevil@mastodon.social")
    }

    @Test("returns nil when the name is entirely format characters")
    func returnsNilWhenNameIsEntirelyFormatCharacters() throws {
        // The name segment decodes to nothing but bidi isolate controls, i.e. an empty name
        // once sanitized — the existing empty-name guard's reasoning applies here too.
        let actor = try #require(URL(string: "https://mastodon.social/users/%E2%81%A6%E2%81%A9"))
        #expect(ActorHandle.derive(from: actor) == nil)
    }
}
