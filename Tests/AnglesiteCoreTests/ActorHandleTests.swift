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
}
