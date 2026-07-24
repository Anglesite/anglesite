import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("ActorProfileFetcher")
struct ActorProfileFetcherTests {
    /// Answers with a canned body, and optionally reports a *different* final URL than the one
    /// requested — which is how a redirect presents itself to the fetcher.
    private static func transport(
        body: String, status: Int = 200, finalURL: String? = nil
    ) -> ActorProfileFetcher.Transport {
        { request in
            let url = finalURL.flatMap(URL.init(string:)) ?? request.url!
            let http = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }
    }

    private static let alice = URL(string: "https://mastodon.social/users/alice")!

    @Test("decodes name, username, and an icon given as an object")
    func decodesObjectIcon() async throws {
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: """
        {"id":"https://mastodon.social/users/alice","type":"Person",
         "preferredUsername":"alice","name":"Alice Example",
         "icon":{"type":"Image","mediaType":"image/png",
                 "url":"https://files.mastodon.social/avatars/alice.png"}}
        """))
        let profile = try await fetcher.profile(for: Self.alice)

        #expect(profile.name == "Alice Example")
        #expect(profile.preferredUsername == "alice")
        #expect(profile.iconURL?.absoluteString
            == "https://files.mastodon.social/avatars/alice.png")
    }

    @Test("decodes an icon given as a bare URL string")
    func decodesStringIcon() async throws {
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: """
        {"preferredUsername":"alice","icon":"https://cdn.example.com/a.png"}
        """))
        let profile = try await fetcher.profile(for: Self.alice)
        #expect(profile.iconURL?.absoluteString == "https://cdn.example.com/a.png")
    }

    @Test("decodes an icon given as an array of image objects")
    func decodesArrayIcon() async throws {
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: """
        {"preferredUsername":"alice",
         "icon":[{"type":"Image","url":"https://cdn.example.com/first.png"},
                 {"type":"Image","url":"https://cdn.example.com/second.png"}]}
        """))
        let profile = try await fetcher.profile(for: Self.alice)
        #expect(profile.iconURL?.absoluteString == "https://cdn.example.com/first.png")
    }

    @Test("tolerates an actor document with no name and no icon")
    func toleratesMissingFields() async throws {
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: #"{"type":"Person"}"#))
        let profile = try await fetcher.profile(for: Self.alice)

        #expect(profile.name == nil)
        #expect(profile.preferredUsername == nil)
        #expect(profile.iconURL == nil)
        #expect(profile.actor == Self.alice)
    }

    /// A follower must not be able to make the app load an avatar over plaintext.
    @Test("drops a non-HTTPS icon URL")
    func dropsInsecureIcon() async throws {
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: """
        {"preferredUsername":"alice","icon":"http://cdn.example.com/a.png"}
        """))
        let profile = try await fetcher.profile(for: Self.alice)
        #expect(profile.iconURL == nil)
    }

    @Test("refuses a non-HTTPS actor IRI without issuing a request")
    func refusesInsecureActor() async throws {
        let fetcher = ActorProfileFetcher(transport: { _ in
            Issue.record("transport must not be called for an insecure actor IRI")
            throw ActorProfileError.insecureURL
        })
        let insecure = try #require(URL(string: "http://mastodon.social/users/alice"))
        await #expect(throws: ActorProfileError.insecureURL) {
            _ = try await fetcher.profile(for: insecure)
        }
    }

    /// URLSession follows redirects transparently, so the body may have come from somewhere other
    /// than the URL asked for — the scheme has to be re-checked against where it actually landed.
    @Test("refuses a response that redirected to a non-HTTPS URL")
    func refusesInsecureRedirect() async throws {
        let fetcher = ActorProfileFetcher(transport: Self.transport(
            body: #"{"preferredUsername":"alice"}"#,
            finalURL: "http://evil.example.com/users/alice"))
        await #expect(throws: ActorProfileError.insecureURL) {
            _ = try await fetcher.profile(for: Self.alice)
        }
    }

    @Test("refuses a body over the size cap")
    func refusesOversizeBody() async throws {
        let huge = String(repeating: "a", count: ActorProfileFetcher.maximumResponseBytes + 1)
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: huge))
        await #expect(throws: ActorProfileError.responseTooLarge(huge.utf8.count)) {
            _ = try await fetcher.profile(for: Self.alice)
        }
    }

    @Test("maps a non-2xx status to requestFailed")
    func mapsNon2xx() async throws {
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: "gone", status: 410))
        await #expect(throws: ActorProfileError.requestFailed(status: 410)) {
            _ = try await fetcher.profile(for: Self.alice)
        }
    }

    /// Amendment (post-Task-1 security finding): a hostile actor document's `name` is arbitrary
    /// attacker-controlled text — more freely so than the IRI path segment `ActorHandle` guards —
    /// and can smuggle a bidi override to visually impersonate a different, trusted name. `decode`
    /// must route it through `DisplayString.safe(_:)` before it ever reaches `ActorProfile`.
    @Test("strips a bidi override from a hostile name")
    func stripsBidiOverrideFromName() async throws {
        let hostile = "Alice \u{202E}ecilA"
        let fetcher = ActorProfileFetcher(transport: Self.transport(body: """
        {"preferredUsername":"alice","name":"\(hostile)"}
        """))
        let profile = try await fetcher.profile(for: Self.alice)

        #expect(profile.name == DisplayString.safe(hostile))
        #expect(profile.name?.unicodeScalars.contains(where: { $0.properties.generalCategory == .format }) == false)
    }

    /// Amendment (whole-branch review): `URLRequest.timeoutInterval` is an *idle* timeout, so a
    /// server that dribbles one byte every nine seconds never trips it and holds one of
    /// `FollowersModel`'s four shared enrichment slots indefinitely. Only
    /// `timeoutIntervalForResource` bounds the whole transfer, and it is settable on a session
    /// configuration and nowhere else — which is why the fetcher can't use `URLSession.shared`.
    ///
    /// Asserting on the configuration rather than on a slow socket: the deadline itself only
    /// fires against a real, deliberately-slow server, which no unit test should stand up.
    @Test("bounds the whole transfer, not just idle time")
    func configuresAWallClockDeadline() throws {
        let configuration = CappedHTTPTransport.configuration(
            requestTimeout: ActorProfileFetcher.timeout,
            resourceTimeout: ActorProfileFetcher.resourceTimeout)

        #expect(configuration.timeoutIntervalForRequest == ActorProfileFetcher.timeout)
        #expect(configuration.timeoutIntervalForResource == ActorProfileFetcher.resourceTimeout)
        // Far below URLSession's 7-day default, which is what "unset" would leave in place.
        #expect(configuration.timeoutIntervalForResource < 60)
    }

    /// An oversize response must not also land in the process-wide `URLCache`.
    @Test("fetches on an ephemeral configuration, not the shared session")
    func usesAnEphemeralConfiguration() throws {
        let configuration = CappedHTTPTransport.configuration(
            requestTimeout: 1, resourceTimeout: 2)
        #expect(configuration.urlCache !== URLSessionConfiguration.default.urlCache)
    }
}
