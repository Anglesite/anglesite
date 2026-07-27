import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("CommunityActorResolver")
struct CommunityActorResolverTests {
    /// Answers each requested URL from a fixed table; unmatched URLs 404. Mirrors
    /// `ActivityPubFollowersClientTests.FakeTransport` but needs per-URL routing since resolving a
    /// handle makes two requests (webfinger, then the actor document) to two different URLs.
    actor FakeTransport {
        private var responses: [String: (status: Int, body: String)]
        private(set) var requestedURLs: [URL] = []
        private(set) var requestedHeaders: [[String: String]] = []

        init(_ responses: [String: (status: Int, body: String)]) {
            self.responses = responses
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            let url = request.url!
            requestedURLs.append(url)
            requestedHeaders.append(request.allHTTPHeaderFields ?? [:])
            let (status, body) = responses[url.absoluteString] ?? (404, "not found")
            let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: CommunityActorResolver.Transport {
            { request in try await self.respond(to: request) }
        }
    }

    private static let actorDocument = """
    {"id":"https://lemmy.ml/c/birding","type":"Group","preferredUsername":"birding",
     "name":"Birding","outbox":"https://lemmy.ml/c/birding/outbox"}
    """

    @Test("resolves a !community@host handle via webfinger then the actor document")
    func resolvesHandle() async throws {
        let webfingerURL = "https://lemmy.ml/.well-known/webfinger?resource=acct:birding@lemmy.ml"
        let fake = FakeTransport([
            webfingerURL: (200, """
                {"subject":"acct:birding@lemmy.ml","links":[
                  {"rel":"self","type":"application/activity+json","href":"https://lemmy.ml/c/birding"}
                ]}
                """),
            "https://lemmy.ml/c/birding": (200, Self.actorDocument),
        ])
        let resolver = CommunityActorResolver(transport: fake.transport)

        let resolved = try await resolver.resolve("!birding@lemmy.ml")

        #expect(resolved.actorID.absoluteString == "https://lemmy.ml/c/birding")
        #expect(resolved.outboxURL?.absoluteString == "https://lemmy.ml/c/birding/outbox")
        #expect(resolved.type == "Group")
        #expect(resolved.name == "Birding")
    }

    @Test("resolves a bare @user@host handle the same way")
    func resolvesAtHandle() async throws {
        let webfingerURL = "https://lemmy.ml/.well-known/webfinger?resource=acct:birding@lemmy.ml"
        let fake = FakeTransport([
            webfingerURL: (200, """
                {"subject":"acct:birding@lemmy.ml","links":[
                  {"rel":"self","type":"application/activity+json","href":"https://lemmy.ml/c/birding"}
                ]}
                """),
            "https://lemmy.ml/c/birding": (200, Self.actorDocument),
        ])
        let resolver = CommunityActorResolver(transport: fake.transport)

        let resolved = try await resolver.resolve("@birding@lemmy.ml")

        #expect(resolved.actorID.absoluteString == "https://lemmy.ml/c/birding")
    }

    @Test("resolves a pasted actor URL directly, skipping webfinger")
    func resolvesURL() async throws {
        let fake = FakeTransport(["https://lemmy.ml/c/birding": (200, Self.actorDocument)])
        let resolver = CommunityActorResolver(transport: fake.transport)

        let resolved = try await resolver.resolve("https://lemmy.ml/c/birding")

        #expect(resolved.actorID.absoluteString == "https://lemmy.ml/c/birding")
        #expect(await fake.requestedURLs.count == 1)
    }

    @Test("sends the AS2 Accept header when fetching the actor document")
    func sendsAcceptHeader() async throws {
        let fake = FakeTransport(["https://lemmy.ml/c/birding": (200, Self.actorDocument)])
        let resolver = CommunityActorResolver(transport: fake.transport)
        _ = try await resolver.resolve("https://lemmy.ml/c/birding")

        let headers = await fake.requestedHeaders
        #expect(headers.last?["Accept"] == ActivityPubFollowersClient.acceptHeader)
    }

    @Test("rejects a plain http URL")
    func rejectsInsecureURL() async throws {
        let fake = FakeTransport([:])
        let resolver = CommunityActorResolver(transport: fake.transport)
        await #expect(throws: CommunityActorResolverError.insecureURL) {
            _ = try await resolver.resolve("http://lemmy.ml/c/birding")
        }
    }

    @Test("rejects unparseable input")
    func rejectsInvalidHandle() async throws {
        let fake = FakeTransport([:])
        let resolver = CommunityActorResolver(transport: fake.transport)
        await #expect(throws: CommunityActorResolverError.invalidHandle) {
            _ = try await resolver.resolve("not a handle or url")
        }
    }

    @Test("surfaces a webfinger 404 as webfingerFailed")
    func webfingerNotFound() async throws {
        let webfingerURL = "https://lemmy.ml/.well-known/webfinger?resource=acct:ghost@lemmy.ml"
        let fake = FakeTransport([webfingerURL: (404, "no such account")])
        let resolver = CommunityActorResolver(transport: fake.transport)

        await #expect(throws: CommunityActorResolverError.webfingerFailed(
            status: 404, body: "no such account")) {
            _ = try await resolver.resolve("!ghost@lemmy.ml")
        }
    }

    @Test("surfaces a webfinger response with no self link as noActorLink")
    func webfingerNoSelfLink() async throws {
        let webfingerURL = "https://lemmy.ml/.well-known/webfinger?resource=acct:birding@lemmy.ml"
        let fake = FakeTransport([
            webfingerURL: (200, """
                {"subject":"acct:birding@lemmy.ml","links":[
                  {"rel":"http://webfinger.net/rel/profile-page","href":"https://lemmy.ml/c/birding"}
                ]}
                """),
        ])
        let resolver = CommunityActorResolver(transport: fake.transport)

        await #expect(throws: CommunityActorResolverError.noActorLink) {
            _ = try await resolver.resolve("!birding@lemmy.ml")
        }
    }

    @Test("rejects a webfinger response that redirects to an insecure URL")
    func webfingerRejectHTTPRedirect() async throws {
        let webfingerURL = "https://lemmy.ml/.well-known/webfinger?resource=acct:birding@lemmy.ml"
        // Create a transport that simulates a redirect by returning an HTTPURLResponse
        // with a different (insecure) URL than the one that was requested.
        actor RedirectingTransport {
            private let body: String
            private(set) var requestCount = 0

            init(body: String) {
                self.body = body
            }

            private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
                let url = request.url!
                requestCount += 1
                // For the webfinger URL, return a response that appears to come from http://
                // (simulating a transparent redirect), which should be rejected.
                let responseURL: URL
                if url.absoluteString.contains("webfinger") {
                    let httpURL = url.absoluteString.replacingOccurrences(of: "https://", with: "http://")
                    responseURL = URL(string: httpURL)!
                } else {
                    // Actor fetch should not reach this point if webfinger check works
                    throw CommunityActorResolverError.requestFailed(status: 500, body: "should not fetch actor")
                }
                let http = HTTPURLResponse(url: responseURL, statusCode: 200, httpVersion: nil, headerFields: nil)!
                return (Data(body.utf8), http)
            }

            nonisolated var transport: CommunityActorResolver.Transport {
                { request in try await self.respond(to: request) }
            }
        }

        let fake = RedirectingTransport(body: """
            {"subject":"acct:birding@lemmy.ml","links":[
              {"rel":"self","type":"application/activity+json","href":"https://lemmy.ml/c/birding"}
            ]}
            """)
        let resolver = CommunityActorResolver(transport: fake.transport)

        await #expect(throws: CommunityActorResolverError.insecureURL) {
            _ = try await resolver.resolve("!birding@lemmy.ml")
        }

        // Verify that we only made the webfinger request, not the actor fetch
        #expect(await fake.requestCount == 1)
    }

    /// Defense-in-depth: `defaultTransport` is already capped via `CappedHTTPTransport`, but a
    /// caller-injected `Transport` (like this test's `FakeTransport`) might not be. The padding
    /// keeps the body *valid* JSON that decodes cleanly but for the size — an invalid/garbage
    /// oversized body would throw `.decodingFailed` regardless of whether the byte-cap guard
    /// exists, making the test vacuous (this exact mistake was already made and caught once for
    /// `GroupTimelineClientTests.rejectsOversizedBody`).
    @Test("rejects an oversized actor document")
    func rejectsOversizedActorDocument() async throws {
        let maxBytes = CommunityActorResolver.maximumResponseBytes
        let prefix = #"{"id":"https://lemmy.ml/c/birding","type":"Group","padding":""#
        let suffix = "\"}"
        let paddingLength = maxBytes - prefix.utf8.count - suffix.utf8.count + 1
        let oversizedBody = prefix + String(repeating: "x", count: paddingLength) + suffix
        let byteCount = Data(oversizedBody.utf8).count
        #expect(byteCount > maxBytes)

        let fake = FakeTransport(["https://lemmy.ml/c/birding": (200, oversizedBody)])
        let resolver = CommunityActorResolver(transport: fake.transport)

        await #expect(throws: CommunityActorResolverError.requestFailed(
            status: 0, body: "response too large (\(byteCount) bytes)")) {
            _ = try await resolver.resolve("https://lemmy.ml/c/birding")
        }
    }

    /// Same guard, exercised through the webfinger call site rather than the actor-document one —
    /// `webfingerResolve` and `fetchActor` each need their own check since neither funnels through
    /// a single shared post-status point.
    @Test("rejects an oversized webfinger response")
    func rejectsOversizedWebfingerResponse() async throws {
        let maxBytes = CommunityActorResolver.maximumResponseBytes
        let prefix = #"{"subject":"acct:birding@lemmy.ml","links":[],"padding":""#
        let suffix = "\"}"
        let paddingLength = maxBytes - prefix.utf8.count - suffix.utf8.count + 1
        let oversizedBody = prefix + String(repeating: "x", count: paddingLength) + suffix
        let byteCount = Data(oversizedBody.utf8).count
        #expect(byteCount > maxBytes)

        let webfingerURL = "https://lemmy.ml/.well-known/webfinger?resource=acct:birding@lemmy.ml"
        let fake = FakeTransport([webfingerURL: (200, oversizedBody)])
        let resolver = CommunityActorResolver(transport: fake.transport)

        await #expect(throws: CommunityActorResolverError.requestFailed(
            status: 0, body: "response too large (\(byteCount) bytes)")) {
            _ = try await resolver.resolve("!birding@lemmy.ml")
        }
    }

    @Test("HTTPS check must come before status check for webfinger redirect handling")
    func webfingerRejectInsecureRedirectWithErrorStatus() async throws {
        // This test proves the ordering fix: a redirect to an insecure URL with a non-2xx
        // status must throw .insecureURL (the redirect check), not .webfingerFailed (which
        // would leak the insecure endpoint's error response). Before the fix, the wrong order
        // (status check first) would throw .webfingerFailed; after the fix, it throws .insecureURL.
        actor MaliciousRedirectTransport {
            private(set) var requestCount = 0

            private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
                let url = request.url!
                requestCount += 1
                // Simulate a redirect to an insecure URL with a non-2xx status
                let httpURL = url.absoluteString.replacingOccurrences(of: "https://", with: "http://")
                let responseURL = URL(string: httpURL)!
                let errorBody = "500 Internal Server Error from insecure endpoint"
                let http = HTTPURLResponse(url: responseURL, statusCode: 500, httpVersion: nil, headerFields: nil)!
                return (Data(errorBody.utf8), http)
            }

            nonisolated var transport: CommunityActorResolver.Transport {
                { request in try await self.respond(to: request) }
            }
        }

        let fake = MaliciousRedirectTransport()
        let resolver = CommunityActorResolver(transport: fake.transport)

        // Must throw .insecureURL, not .webfingerFailed, to avoid leaking the insecure
        // endpoint's error response
        await #expect(throws: CommunityActorResolverError.insecureURL) {
            _ = try await resolver.resolve("!birding@lemmy.ml")
        }

        // Verify that we only made the webfinger request, not the actor fetch
        #expect(await fake.requestCount == 1)
    }
}
