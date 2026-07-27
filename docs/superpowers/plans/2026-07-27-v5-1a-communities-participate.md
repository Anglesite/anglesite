# V-5.1a Communities — Join/Leave + Group Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Anglesite site join and leave existing fediverse `Group` actors (Lemmy, PieFed, Mbin, Friendica communities) by handle or URL, and read a per-group timeline, from a new Communities pane in the site window.

**Architecture:** Four new `AnglesiteCore` types provide the protocol plumbing — a handle/URL resolver (webfinger + direct AS2 fetch), an outbound `Follow`/`Undo(Follow)` client reusing the site's existing ActivityPub publish token, a paged reader for a remote Group's public outbox, and a local JSON ledger of joined communities (there is no public "following" collection to query back, so membership is app-recorded, mirroring `ActivityPubOutboxLedger`). One new `AnglesiteApp` model/view pair (`CommunitiesModel`/`CommunitiesView`) orchestrates them, wired into `SiteWindowModel`/`SiteWindow`/`WebsiteCommands` exactly like the existing Followers and Reader panes (V-4.2/#364, V-4.3/#365).

**Tech Stack:** Swift 6.4, SwiftUI, `Observation`, Swift Testing (`Testing` framework, not XCTest), `URLSession`/`CappedHTTPTransport` for capped remote fetches, Keychain-backed `SecretStore` for the existing per-site ActivityPub publish token.

## Global Constraints

- Every new client mirrors the injectable-`Transport` shape already used by `ActivityPubFollowersClient`/`ActorProfileFetcher`/`MicrosubClient`: `public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)`, defaulting to a production transport, so nothing needs real networking in tests.
- Every fetch of a **remote, attacker-influenced** host (webfinger, an arbitrary actor document, a Group's outbox) is HTTPS-only (re-checked after redirects, `ActorProfileFetcher.requireHTTPS` pattern) and byte-capped via `CappedHTTPTransport`, same as `ActorProfileFetcher`.
- Every remote-supplied display string (name, handle, host) is sanitized through `DisplayString.safe` before it reaches a view, same as `ActorHandle`/`ActorProfile` already do.
- Outbound `Follow`/`Undo(Follow)` POSTs go to **this site's own** `<actor>/outbox` with `Authorization: Bearer <publishToken>` — the same endpoint and the same `SecretAccounts.activityPubPublishToken(siteID:)` secret `ActivityPubOutboxBackfill` already uses. No new secret, no new provisioning.
- Scope is **read + join/leave only** (the issue's own title and plan). Posting *to* a community (`audience` field on typed content) is #369, and directory browse/search is #371 — both out of scope here.
- Every new Swift Testing suite follows the existing `@Suite("TypeName") struct TypeNameTests` / `actor FakeTransport` convention seen in `Tests/AnglesiteCoreTests/ActivityPubFollowersClientTests.swift`.
- Conventional commits, one per task, referencing `#368`.

---

## File Map

| File | Responsibility |
|---|---|
| `Sources/AnglesiteCore/CommunityActorResolver.swift` | Parse a handle/URL, resolve it (webfinger or direct fetch) to a `ResolvedCommunityActor`. |
| `Sources/AnglesiteCore/CommunityMembershipClient.swift` | POST `Follow`/`Undo(Follow)` to this site's own outbox. |
| `Sources/AnglesiteCore/GroupTimelineClient.swift` | Page a remote Group's public outbox into `GroupPost`s. |
| `Sources/AnglesiteCore/CommunitiesLedger.swift` | `Config/activitypub-communities.json` — which groups this site has joined. |
| `Sources/AnglesiteApp/CommunitiesModel.swift` | `@Observable` model driving the Communities pane. |
| `Sources/AnglesiteApp/CommunitiesView.swift` | SwiftUI view: join field, joined-community list, per-group timeline. |
| `Sources/AnglesiteApp/SiteWindowModel.swift` | Add `.communities` pane mode + `presentCommunities()` + `communities.configure(site:)`. |
| `Sources/AnglesiteApp/SiteWindow.swift` | Add the `.communities` switch case. |
| `Sources/AnglesiteApp/WebsiteCommands.swift` | Add "Communities…" menu item. |
| `Tests/AnglesiteCoreTests/CommunityActorResolverTests.swift` | Resolver tests. |
| `Tests/AnglesiteCoreTests/CommunityMembershipClientTests.swift` | Follow/Undo client tests. |
| `Tests/AnglesiteCoreTests/GroupTimelineClientTests.swift` | Timeline paging tests. |
| `Tests/AnglesiteCoreTests/CommunitiesLedgerTests.swift` | Ledger persistence tests. |
| `Tests/AnglesiteAppTests/CommunitiesModelTests.swift` | Model orchestration tests. |

---

### Task 1: `CommunityActorResolver` — handle/URL → actor document

**Files:**
- Create: `Sources/AnglesiteCore/CommunityActorResolver.swift`
- Test: `Tests/AnglesiteCoreTests/CommunityActorResolverTests.swift`

**Interfaces:**
- Produces: `public struct ResolvedCommunityActor: Sendable, Equatable { public let actorID: URL; public let outboxURL: URL?; public let type: String?; public let preferredUsername: String?; public let name: String?; public let handle: String? }`, `public enum CommunityActorResolverError: Error, Equatable, Sendable { case invalidHandle, insecureURL, webfingerFailed(status: Int, body: String), noActorLink, requestFailed(status: Int, body: String), decodingFailed(String) }`, `public struct CommunityActorResolver: Sendable { public init(transport: Transport = .defaultTransport); public func resolve(_ input: String) async throws -> ResolvedCommunityActor }`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/CommunityActorResolverTests.swift
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
}
```

- [ ] **Step 2: Run the tests to verify they fail (type doesn't exist yet)**

Run: `swift test --package-path . --filter CommunityActorResolverTests`
Expected: FAIL — "cannot find type 'CommunityActorResolver' in scope"

- [ ] **Step 3: Implement `CommunityActorResolver`**

```swift
// Sources/AnglesiteCore/CommunityActorResolver.swift
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A remote actor resolved from a fediverse handle or a pasted URL — the join flow's first step
/// (V-5.1a, #368). Carries just enough to display a confirmation ("Join Birding (Lemmy)?"),
/// address a `Follow`, and read the group's timeline.
public struct ResolvedCommunityActor: Sendable, Equatable {
    /// The actor document's own `id` — the canonical IRI to address a `Follow`'s `object` at.
    /// May differ from the URL that was fetched (webfinger's `self` link, or a pasted URL that
    /// redirected).
    public let actorID: URL
    /// The actor's public outbox collection, for `GroupTimelineClient`. `nil` for an actor
    /// document that doesn't advertise one — the timeline pane degrades to "no timeline available".
    public let outboxURL: URL?
    public let type: String?
    public let preferredUsername: String?
    public let name: String?
    /// The `@name@host` (or `!name@host`) form the owner typed, sanitized for display.
    public let handle: String?

    public init(
        actorID: URL, outboxURL: URL?, type: String?, preferredUsername: String?, name: String?,
        handle: String?
    ) {
        self.actorID = actorID
        self.outboxURL = outboxURL
        self.type = type
        self.preferredUsername = preferredUsername
        self.name = name
        self.handle = handle
    }
}

public enum CommunityActorResolverError: Error, Equatable, Sendable {
    case invalidHandle
    case insecureURL
    case webfingerFailed(status: Int, body: String)
    /// The webfinger response had no `rel: "self"` AS2 link to follow.
    case noActorLink
    case requestFailed(status: Int, body: String)
    case decodingFailed(String)
}

/// Resolves a fediverse handle (`!community@host`, `@user@host`, bare `name@host`) or a pasted
/// actor URL to its actor document. Mirrors `@dwk/webfinger`'s `lookup.ts` (`parseHandle`,
/// `webfingerQueryUrl`, `selectActorLink`, `resolveHandle`) client-side in Swift: this app makes
/// its own outbound request as the signed-in user, so — like `ActorProfileFetcher` — it needs
/// HTTPS-only and a byte cap, not the server-side SSRF guard `@dwk/activitypub`'s own resolver
/// applies (that guard exists because *that* resolution runs inside a shared Cloudflare Worker).
public struct CommunityActorResolver: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let transport: Transport

    public init(transport: @escaping Transport = CommunityActorResolver.defaultTransport) {
        self.transport = transport
    }

    public func resolve(_ input: String) async throws -> ResolvedCommunityActor {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), let scheme = url.scheme, url.host != nil,
           ["http", "https"].contains(scheme.lowercased()) {
            try Self.requireHTTPS(url)
            return try await fetchActor(at: url, handle: nil)
        }
        guard let (name, host) = Self.parseHandle(trimmed) else {
            throw CommunityActorResolverError.invalidHandle
        }
        let actorURL = try await webfingerResolve(name: name, host: host)
        return try await fetchActor(at: actorURL, handle: DisplayString.safe("@\(name)@\(host)"))
    }

    /// Strips an optional leading `@`/`!` sigil, then splits on the *last* `@` so a name segment
    /// that itself contains `@` (unlikely, but not this code's job to reject) still yields the
    /// intended host. Returns `nil` for input with no `@` at all — the "not a handle" signal that
    /// sends the caller down the URL path (which will itself reject it as invalid).
    static func parseHandle(_ input: String) -> (name: String, host: String)? {
        var body = input
        if body.hasPrefix("@") || body.hasPrefix("!") { body.removeFirst() }
        guard let atIndex = body.lastIndex(of: "@") else { return nil }
        let name = String(body[body.startIndex..<atIndex])
        let host = String(body[body.index(after: atIndex)...])
        guard !name.isEmpty, !host.isEmpty else { return nil }
        return (name, host)
    }

    private func webfingerResolve(name: String, host: String) async throws -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = "/.well-known/webfinger"
        components.queryItems = [URLQueryItem(name: "resource", value: "acct:\(name)@\(host)")]
        guard let webfingerURL = components.url else { throw CommunityActorResolverError.invalidHandle }

        var request = URLRequest(url: webfingerURL)
        request.httpMethod = "GET"
        request.timeoutInterval = ActorProfileFetcher.timeout
        let (data, http) = try await send(request)
        guard (200..<300).contains(http.statusCode) else {
            throw CommunityActorResolverError.webfingerFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        struct Link: Decodable { let rel: String?; let type: String?; let href: String? }
        struct DTO: Decodable { let links: [Link]? }
        let dto: DTO
        do {
            dto = try JSONDecoder().decode(DTO.self, from: data)
        } catch {
            throw CommunityActorResolverError.decodingFailed("\(error)")
        }
        guard let href = dto.links?.first(where: {
            $0.rel == "self" && ($0.type?.contains("activity+json") == true || $0.type?.contains("ld+json") == true)
        })?.href, let actorURL = URL(string: href) else {
            throw CommunityActorResolverError.noActorLink
        }
        try Self.requireHTTPS(actorURL)
        return actorURL
    }

    private func fetchActor(at url: URL, handle: String?) async throws -> ResolvedCommunityActor {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(ActivityPubFollowersClient.acceptHeader, forHTTPHeaderField: "Accept")
        request.timeoutInterval = ActorProfileFetcher.timeout
        let (data, http) = try await send(request)
        if let finalURL = http.url { try Self.requireHTTPS(finalURL) }
        guard (200..<300).contains(http.statusCode) else {
            throw CommunityActorResolverError.requestFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        struct DTO: Decodable {
            let id: String
            let type: String?
            let preferredUsername: String?
            let name: String?
            let outbox: String?
        }
        do {
            let dto = try JSONDecoder().decode(DTO.self, from: data)
            guard let actorID = URL(string: dto.id) else {
                throw CommunityActorResolverError.decodingFailed("actor id is not a URL: \(dto.id)")
            }
            return ResolvedCommunityActor(
                actorID: actorID,
                outboxURL: dto.outbox.flatMap(URL.init(string:)),
                type: dto.type,
                preferredUsername: dto.preferredUsername.map(DisplayString.safe),
                name: dto.name.map(DisplayString.safe),
                handle: handle)
        } catch let error as CommunityActorResolverError {
            throw error
        } catch {
            throw CommunityActorResolverError.decodingFailed("\(error)")
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await transport(request)
        } catch {
            throw CommunityActorResolverError.requestFailed(status: 0, body: "\(error)")
        }
    }

    static func requireHTTPS(_ url: URL) throws {
        guard url.scheme?.lowercased() == "https" else { throw CommunityActorResolverError.insecureURL }
    }

    private static let session = CappedHTTPTransport.session(
        requestTimeout: ActorProfileFetcher.timeout, resourceTimeout: ActorProfileFetcher.resourceTimeout)

    public static let defaultTransport: Transport = { request in
        try await CappedHTTPTransport.fetch(
            request, session: session, cap: ActorProfileFetcher.maximumResponseBytes,
            tooLarge: { CommunityActorResolverError.requestFailed(status: 0, body: "response too large (\($0) bytes)") })
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter CommunityActorResolverTests`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CommunityActorResolver.swift Tests/AnglesiteCoreTests/CommunityActorResolverTests.swift
git commit -m "feat(#368): resolve a community handle or URL to its actor document"
```

---

### Task 2: `CommunityMembershipClient` — outbound Follow/Undo(Follow)

**Files:**
- Create: `Sources/AnglesiteCore/CommunityMembershipClient.swift`
- Test: `Tests/AnglesiteCoreTests/CommunityMembershipClientTests.swift`

**Interfaces:**
- Consumes: `ResolvedCommunityActor.actorID` (Task 1) as the `Follow`/`Undo` target; `ActivityPubActor.actorURL(siteURL:)` (existing) as this site's own actor, whose `/outbox` this POSTs to.
- Produces: `public struct CommunityMembershipClient: Sendable { public init(ownActorURL: URL, publishToken: String, transport: Transport = .defaultTransport); public func follow(target: URL) async throws -> String /* activity id */; public func unfollow(target: URL, followActivityID: String?) async throws }`, `public enum CommunityMembershipError: Error, Equatable, Sendable { case requestFailed(status: Int, body: String), decodingFailed(String) }`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/CommunityMembershipClientTests.swift
import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("CommunityMembershipClient")
struct CommunityMembershipClientTests {
    actor FakeTransport {
        private let status: Int
        private let body: String
        private(set) var requestedURLs: [URL] = []
        private(set) var requestedHeaders: [[String: String]] = []
        private(set) var requestedBodies: [[String: Any]] = []

        init(status: Int = 202, body: String = "{}") {
            self.status = status
            self.body = body
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            requestedURLs.append(request.url!)
            requestedHeaders.append(request.allHTTPHeaderFields ?? [:])
            if let bodyData = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any] {
                requestedBodies.append(json)
            }
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: CommunityMembershipClient.Transport {
            { request in try await self.respond(to: request) }
        }
    }

    private static func client(_ fake: FakeTransport) -> CommunityMembershipClient {
        CommunityMembershipClient(
            ownActorURL: URL(string: "https://example.com/users/site")!,
            publishToken: "secret-token",
            transport: fake.transport)
    }

    @Test("POSTs a Follow activity to this site's own outbox")
    func postsFollow() async throws {
        let fake = FakeTransport(status: 202, body: #"{"id":"https://example.com/users/site/outbox/1"}"#)
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        let activityID = try await Self.client(fake).follow(target: target)

        #expect(activityID == "https://example.com/users/site/outbox/1")
        #expect(await fake.requestedURLs.first?.absoluteString == "https://example.com/users/site/outbox")
        let headers = await fake.requestedHeaders.first
        #expect(headers?["Authorization"] == "Bearer secret-token")
        let body = await fake.requestedBodies.first
        #expect(body?["type"] as? String == "Follow")
        #expect(body?["object"] as? String == "https://lemmy.ml/c/birding")
        #expect(body?["actor"] as? String == "https://example.com/users/site")
    }

    @Test("falls back to the target URL as the activity id when the response carries none")
    func followWithoutIDInResponse() async throws {
        let fake = FakeTransport(status: 202, body: "{}")
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        let activityID = try await Self.client(fake).follow(target: target)

        #expect(activityID == "https://lemmy.ml/c/birding")
    }

    @Test("POSTs an Undo(Follow) referencing the original activity id")
    func postsUndoWithActivityID() async throws {
        let fake = FakeTransport()
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        try await Self.client(fake).unfollow(
            target: target, followActivityID: "https://example.com/users/site/outbox/1")

        let body = await fake.requestedBodies.first
        #expect(body?["type"] as? String == "Undo")
        #expect(body?["object"] as? String == "https://example.com/users/site/outbox/1")
    }

    @Test("synthesizes a nested Follow object for Undo when no activity id is known")
    func postsUndoWithoutActivityID() async throws {
        let fake = FakeTransport()
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        try await Self.client(fake).unfollow(target: target, followActivityID: nil)

        let body = await fake.requestedBodies.first
        #expect(body?["type"] as? String == "Undo")
        let nestedFollow = body?["object"] as? [String: Any]
        #expect(nestedFollow?["type"] as? String == "Follow")
        #expect(nestedFollow?["object"] as? String == "https://lemmy.ml/c/birding")
    }

    @Test("maps a non-2xx status to requestFailed")
    func mapsNon2xx() async throws {
        let fake = FakeTransport(status: 403, body: "forbidden")
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))
        await #expect(throws: CommunityMembershipError.requestFailed(status: 403, body: "forbidden")) {
            _ = try await Self.client(fake).follow(target: target)
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter CommunityMembershipClientTests`
Expected: FAIL — "cannot find type 'CommunityMembershipClient' in scope"

- [ ] **Step 3: Implement `CommunityMembershipClient`**

```swift
// Sources/AnglesiteCore/CommunityMembershipClient.swift
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum CommunityMembershipError: Error, Equatable, Sendable {
    case requestFailed(status: Int, body: String)
    case decodingFailed(String)
}

/// Joins/leaves a fediverse `Group` (V-5.1a, #368) by POSTing `Follow`/`Undo(Follow)` to this
/// site's own outbox — the same owner-gated endpoint and `publishToken` bearer
/// `ActivityPubOutboxBackfill` already uses (`@dwk/activitypub`'s "Owner-published Follow /
/// Undo(Follow) now record the relationship and deliver to the target actor" behavior, phase 2).
/// This site's Worker is the trusted party here (it holds the signing key and does the actual
/// federated delivery), so — unlike `CommunityActorResolver` — there is no HTTPS/size-cap guard
/// on this client itself; the target IRI it's given already passed through that resolver.
public struct CommunityMembershipClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let outboxURL: URL
    private let ownActorURL: URL
    private let publishToken: String
    private let transport: Transport

    public init(
        ownActorURL: URL, publishToken: String,
        transport: @escaping Transport = CommunityMembershipClient.defaultTransport
    ) {
        self.ownActorURL = ownActorURL
        self.outboxURL = ownActorURL.appendingPathComponent("outbox")
        self.publishToken = publishToken
        self.transport = transport
    }

    /// Returns the activity id the outbox reports back — persist it (`CommunitiesLedger`) so
    /// `unfollow` can reference the exact original `Follow` in its `Undo`.
    @discardableResult
    public func follow(target: URL) async throws -> String {
        let body: [String: Any] = [
            "@context": "https://www.w3.org/ns/activitystreams",
            "type": "Follow",
            "actor": ownActorURL.absoluteString,
            "object": target.absoluteString,
        ]
        let data = try await post(body)
        return Self.activityID(from: data) ?? target.absoluteString
    }

    /// `followActivityID` is the id `follow(target:)` returned, if this membership was joined
    /// through this client (the common case). When it's `nil` — e.g. membership predates this
    /// feature — a synthetic nested `Follow` object stands in, a shape most AP implementations
    /// accept for `Undo` since the concrete activity id was never recorded client-side.
    public func unfollow(target: URL, followActivityID: String?) async throws {
        let followObject: Any = followActivityID ?? [
            "type": "Follow",
            "actor": ownActorURL.absoluteString,
            "object": target.absoluteString,
        ]
        let body: [String: Any] = [
            "@context": "https://www.w3.org/ns/activitystreams",
            "type": "Undo",
            "actor": ownActorURL.absoluteString,
            "object": followObject,
        ]
        _ = try await post(body)
    }

    private func post(_ activity: [String: Any]) async throws -> Data {
        var request = URLRequest(url: outboxURL)
        request.httpMethod = "POST"
        request.setValue("application/activity+json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(publishToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: activity)

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw CommunityMembershipError.requestFailed(status: 0, body: "\(error)")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw CommunityMembershipError.requestFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        return data
    }

    static func activityID(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["id"] as? String
    }

    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter CommunityMembershipClientTests`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CommunityMembershipClient.swift Tests/AnglesiteCoreTests/CommunityMembershipClientTests.swift
git commit -m "feat(#368): send Follow/Undo(Follow) to join and leave a community"
```

---

### Task 3: `GroupTimelineClient` — a Group's public outbox, paged

**Files:**
- Create: `Sources/AnglesiteCore/GroupTimelineClient.swift`
- Test: `Tests/AnglesiteCoreTests/GroupTimelineClientTests.swift`

**Interfaces:**
- Consumes: `ResolvedCommunityActor.outboxURL` (Task 1) as the collection to page.
- Produces: `public struct GroupPost: Sendable, Equatable, Identifiable { public let id: String; public let title: String?; public let contentHTML: String?; public let url: URL?; public let publishedAt: Date?; public let authorName: String? }`, `public struct GroupTimelinePage: Sendable, Equatable { public let items: [GroupPost]; public let next: URL? }`, `public struct GroupTimelineClient: Sendable { public init(transport: Transport = .defaultTransport); public func collection(at outboxURL: URL) async throws -> (totalItems: Int, firstPage: URL?); public func page(at url: URL) async throws -> GroupTimelinePage }`, `public enum GroupTimelineError: Error, Equatable, Sendable { case requestFailed(status: Int, body: String), decodingFailed(String) }`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/GroupTimelineClientTests.swift
import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("GroupTimelineClient")
struct GroupTimelineClientTests {
    actor FakeTransport {
        private let status: Int
        private let body: String
        private(set) var requestedURLs: [URL] = []

        init(status: Int = 200, body: String) {
            self.status = status
            self.body = body
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            requestedURLs.append(request.url!)
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: GroupTimelineClient.Transport {
            { request in try await self.respond(to: request) }
        }
    }

    @Test("reads the outbox collection head")
    func readsCollectionHead() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://lemmy.ml/c/birding/outbox","type":"OrderedCollection","totalItems":2,
         "first":"https://lemmy.ml/c/birding/outbox?page=1"}
        """)
        let outboxURL = try #require(URL(string: "https://lemmy.ml/c/birding/outbox"))
        let result = try await GroupTimelineClient(transport: fake.transport).collection(at: outboxURL)

        #expect(result.totalItems == 2)
        #expect(result.firstPage?.absoluteString == "https://lemmy.ml/c/birding/outbox?page=1")
    }

    @Test("decodes a page of Create-wrapped Note activities into GroupPosts")
    func decodesCreateWrappedPage() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://lemmy.ml/c/birding/outbox?page=1","type":"OrderedCollectionPage",
         "orderedItems":[
           {"id":"https://lemmy.ml/activities/1","type":"Create",
            "object":{"id":"https://lemmy.ml/post/1","type":"Page","name":"Osprey sighting",
                      "content":"<p>Saw one today</p>","url":"https://lemmy.ml/post/1",
                      "published":"2026-07-20T12:00:00Z",
                      "attributedTo":"https://lemmy.ml/u/alice"}}
         ],
         "next":"https://lemmy.ml/c/birding/outbox?page=2"}
        """)
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox?page=1"))
        let page = try await GroupTimelineClient(transport: fake.transport).page(at: url)

        #expect(page.items.count == 1)
        #expect(page.items[0].id == "https://lemmy.ml/post/1")
        #expect(page.items[0].title == "Osprey sighting")
        #expect(page.items[0].contentHTML == "<p>Saw one today</p>")
        #expect(page.items[0].url?.absoluteString == "https://lemmy.ml/post/1")
        #expect(page.next?.absoluteString == "https://lemmy.ml/c/birding/outbox?page=2")
    }

    @Test("falls back to a bare-id stub for an item with no embedded object")
    func decodesBareIDItem() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://lemmy.ml/c/birding/outbox?page=1","type":"OrderedCollectionPage",
         "orderedItems":["https://lemmy.ml/activities/2"]}
        """)
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox?page=1"))
        let page = try await GroupTimelineClient(transport: fake.transport).page(at: url)

        #expect(page.items.count == 1)
        #expect(page.items[0].id == "https://lemmy.ml/activities/2")
        #expect(page.items[0].title == nil)
    }

    @Test("maps a non-2xx status to requestFailed")
    func mapsNon2xx() async throws {
        let fake = FakeTransport(status: 404, body: "not found")
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox"))
        await #expect(throws: GroupTimelineError.requestFailed(status: 404, body: "not found")) {
            _ = try await GroupTimelineClient(transport: fake.transport).collection(at: url)
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter GroupTimelineClientTests`
Expected: FAIL — "cannot find type 'GroupTimelineClient' in scope"

- [ ] **Step 3: Implement `GroupTimelineClient`**

```swift
// Sources/AnglesiteCore/GroupTimelineClient.swift
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One post from a joined community's public timeline (V-5.1a, #368) — deliberately minimal:
/// enough to render a row and open the original. `id` is the wrapped object's `id` when present
/// (a real post), else the bare activity id (an item this parser couldn't unwrap further, still
/// worth a stub row so the timeline's count matches the collection's).
public struct GroupPost: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String?
    public let contentHTML: String?
    public let url: URL?
    public let publishedAt: Date?
    public let authorName: String?

    public init(
        id: String, title: String?, contentHTML: String?, url: URL?, publishedAt: Date?,
        authorName: String?
    ) {
        self.id = id
        self.title = title
        self.contentHTML = contentHTML
        self.url = url
        self.publishedAt = publishedAt
        self.authorName = authorName
    }
}

public struct GroupTimelinePage: Sendable, Equatable {
    public let items: [GroupPost]
    public let next: URL?

    public init(items: [GroupPost], next: URL?) {
        self.items = items
        self.next = next
    }
}

public enum GroupTimelineError: Error, Equatable, Sendable {
    case requestFailed(status: Int, body: String)
    case decodingFailed(String)
}

/// Reads a Group actor's public outbox (V-5.1a, #368) — the per-group timeline. Same
/// unauthenticated, capped, AS2-collection-paging shape as `ActivityPubFollowersClient`, but the
/// collection belongs to an arbitrary *remote* Group rather than this site's own followers, and
/// each item is a full (or partial) activity to render rather than a bare actor IRI. AS2 is loose
/// about wire shape here (a bare activity-id string, or a fully embedded activity), so this parses
/// with `JSONSerialization` — like `ActivityPubOutboxBackfill.activityID(from:)` — rather than
/// fighting `Decodable` over a heterogeneous array.
public struct GroupTimelineClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let transport: Transport

    public init(transport: @escaping Transport = GroupTimelineClient.defaultTransport) {
        self.transport = transport
    }

    public func collection(at outboxURL: URL) async throws -> (totalItems: Int, firstPage: URL?) {
        let json = try await fetch(outboxURL)
        let totalItems = json["totalItems"] as? Int ?? 0
        let firstPage = (json["first"] as? String).flatMap(URL.init(string:))
        return (totalItems, firstPage)
    }

    public func page(at url: URL) async throws -> GroupTimelinePage {
        let json = try await fetch(url)
        let rawItems = (json["orderedItems"] as? [Any]) ?? []
        let items = rawItems.compactMap(Self.post(from:))
        let next = (json["next"] as? String).flatMap(URL.init(string:))
        return GroupTimelinePage(items: items, next: next)
    }

    private func fetch(_ url: URL) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(ActivityPubFollowersClient.acceptHeader, forHTTPHeaderField: "Accept")
        request.timeoutInterval = ActorProfileFetcher.timeout

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw GroupTimelineError.requestFailed(status: 0, body: "\(error)")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw GroupTimelineError.requestFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GroupTimelineError.decodingFailed("not a JSON object")
        }
        return json
    }

    /// Unwraps one `Create`/`Announce` level to reach the actual post object; a bare-string item
    /// (just an activity IRI, no embedded object) becomes an id-only stub rather than being
    /// dropped, so the rendered row count still matches `totalItems`.
    static func post(from item: Any) -> GroupPost? {
        if let bareID = item as? String {
            return GroupPost(
                id: bareID, title: nil, contentHTML: nil, url: nil, publishedAt: nil, authorName: nil)
        }
        guard let activity = item as? [String: Any] else { return nil }
        let object = (activity["object"] as? [String: Any]) ?? activity
        guard let id = object["id"] as? String ?? activity["id"] as? String else { return nil }

        let publishedAt = (object["published"] as? String).flatMap {
            ISO8601DateFormatter().date(from: $0)
        }
        return GroupPost(
            id: id,
            title: (object["name"] as? String).map(DisplayString.safe),
            contentHTML: object["content"] as? String,
            url: (object["url"] as? String).flatMap(URL.init(string:)),
            publishedAt: publishedAt,
            authorName: (object["attributedTo"] as? String).map(DisplayString.safe))
    }

    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter GroupTimelineClientTests`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/GroupTimelineClient.swift Tests/AnglesiteCoreTests/GroupTimelineClientTests.swift
git commit -m "feat(#368): read a joined community's public outbox as a timeline"
```

---

### Task 4: `CommunitiesLedger` — which groups this site has joined

**Files:**
- Create: `Sources/AnglesiteCore/CommunitiesLedger.swift`
- Test: `Tests/AnglesiteCoreTests/CommunitiesLedgerTests.swift`

**Interfaces:**
- Produces: `public struct JoinedCommunity: Codable, Equatable, Sendable, Identifiable { public let actorID: URL; public let outboxURL: URL?; public let handle: String?; public let displayName: String?; public let joinedAt: Date; public let followActivityID: String?; public var id: String }`, `public struct CommunitiesLedger: Codable, Equatable, Sendable { public init(communities: [JoinedCommunity] = []); public private(set) var communities: [JoinedCommunity]; public func contains(actorID: URL) -> Bool; public mutating func record(_ community: JoinedCommunity); public mutating func remove(actorID: URL); public static func load(from configDirectory: URL) -> CommunitiesLedger?; public func save(to configDirectory: URL) throws; public static let filename: String }`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/CommunitiesLedgerTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("CommunitiesLedger")
struct CommunitiesLedgerTests {
    private static func sample(handle: String = "@birding@lemmy.ml") -> JoinedCommunity {
        JoinedCommunity(
            actorID: URL(string: "https://lemmy.ml/c/birding")!,
            outboxURL: URL(string: "https://lemmy.ml/c/birding/outbox")!,
            handle: handle,
            displayName: "Birding",
            joinedAt: Date(timeIntervalSince1970: 1_700_000_000),
            followActivityID: "https://example.com/users/site/outbox/1")
    }

    @Test("record then contains reports true for the same actorID")
    func recordAndContains() {
        var ledger = CommunitiesLedger()
        #expect(!ledger.contains(actorID: Self.sample().actorID))
        ledger.record(Self.sample())
        #expect(ledger.contains(actorID: Self.sample().actorID))
        #expect(ledger.communities.count == 1)
    }

    @Test("recording the same actorID twice does not duplicate")
    func recordIsIdempotent() {
        var ledger = CommunitiesLedger()
        ledger.record(Self.sample())
        ledger.record(Self.sample(handle: "@birding@lemmy.ml"))
        #expect(ledger.communities.count == 1)
    }

    @Test("remove drops the matching community and leaves the rest")
    func remove() {
        var ledger = CommunitiesLedger()
        ledger.record(Self.sample())
        let other = JoinedCommunity(
            actorID: URL(string: "https://mastodon.social/c/other")!, outboxURL: nil,
            handle: nil, displayName: nil, joinedAt: Date(), followActivityID: nil)
        ledger.record(other)

        ledger.remove(actorID: Self.sample().actorID)

        #expect(ledger.communities == [other])
    }

    @Test("save then load round-trips through JSON on disk")
    func saveAndLoadRoundTrip() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-ledger-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: tempDir) }

        var ledger = CommunitiesLedger()
        ledger.record(Self.sample())
        try ledger.save(to: tempDir)

        let loaded = try #require(CommunitiesLedger.load(from: tempDir))
        #expect(loaded == ledger)
    }

    @Test("load returns nil when no ledger file exists yet")
    func loadMissingFileReturnsNil() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-ledger-missing-\(UUID().uuidString)")
        #expect(CommunitiesLedger.load(from: tempDir) == nil)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter CommunitiesLedgerTests`
Expected: FAIL — "cannot find type 'CommunitiesLedger' in scope"

- [ ] **Step 3: Implement `CommunitiesLedger`**

```swift
// Sources/AnglesiteCore/CommunitiesLedger.swift
import Foundation

/// One community this site has joined (V-5.1a, #368).
public struct JoinedCommunity: Codable, Equatable, Sendable, Identifiable {
    public let actorID: URL
    /// For `GroupTimelineClient` — `nil` if the actor document didn't advertise one.
    public let outboxURL: URL?
    public let handle: String?
    public let displayName: String?
    public let joinedAt: Date
    /// The `Follow` activity id `CommunityMembershipClient.follow(target:)` returned — threaded
    /// back into `unfollow(target:followActivityID:)` on leave.
    public let followActivityID: String?

    public var id: String { actorID.absoluteString }

    public init(
        actorID: URL, outboxURL: URL?, handle: String?, displayName: String?, joinedAt: Date,
        followActivityID: String?
    ) {
        self.actorID = actorID
        self.outboxURL = outboxURL
        self.handle = handle
        self.displayName = displayName
        self.joinedAt = joinedAt
        self.followActivityID = followActivityID
    }
}

/// Durable per-site record of which fediverse communities this site has joined —
/// `Config/activitypub-communities.json`, app-owned, never in git. There is no public "following"
/// collection to read this back from (`@dwk/activitypub` exposes `followers`, not `following`, as
/// a public AS2 collection), so this ledger — not the Worker — is the source of truth for what the
/// Communities pane lists. Same shape and crash-safety contract as `ActivityPubOutboxLedger`.
public struct CommunitiesLedger: Codable, Equatable, Sendable {
    public static let filename = "activitypub-communities.json"

    public private(set) var communities: [JoinedCommunity]

    public init(communities: [JoinedCommunity] = []) {
        self.communities = communities
    }

    public func contains(actorID: URL) -> Bool {
        communities.contains { $0.actorID == actorID }
    }

    /// No-ops if `actorID` is already recorded — matches `ActivityPubOutboxLedger.record`'s
    /// idempotent-insert contract.
    public mutating func record(_ community: JoinedCommunity) {
        guard !contains(actorID: community.actorID) else { return }
        communities.append(community)
    }

    public mutating func remove(actorID: URL) {
        communities.removeAll { $0.actorID == actorID }
    }

    private struct Envelope: Codable {
        let communities: [JoinedCommunity]
    }

    public static func load(from configDirectory: URL) -> CommunitiesLedger? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return CommunitiesLedger(communities: envelope.communities)
    }

    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(communities: communities))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter CommunitiesLedgerTests`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CommunitiesLedger.swift Tests/AnglesiteCoreTests/CommunitiesLedgerTests.swift
git commit -m "feat(#368): persist which communities a site has joined"
```

---

### Task 5: `CommunitiesModel` — orchestration

**Files:**
- Create: `Sources/AnglesiteApp/CommunitiesModel.swift`
- Test: `Tests/AnglesiteAppTests/CommunitiesModelTests.swift`

**Interfaces:**
- Consumes: `CommunityActorResolver.resolve(_:)`, `CommunityMembershipClient.follow(target:)`/`.unfollow(target:followActivityID:)`, `GroupTimelineClient.collection(at:)`/`.page(at:)`, `CommunitiesLedger`, `ActivityPubActor.actorURL(siteURL:)`, `DeployCoordinator.resolveSiteURL(siteDirectory:)`, `SecretStore`/`SecretAccounts.activityPubPublishToken(siteID:)`, `CurrentSite`.
- Produces: `@MainActor @Observable final class CommunitiesModel { init(secretStore:resolverTransport:membershipTransport:timelineTransport:); func configure(site: CurrentSite); func join() async; func requestLeave(_ community: JoinedCommunity); func confirmLeave() async; func cancelLeave(); func selectCommunity(_ id: String); func loadTimeline() async }` plus published state used by Task 6's view: `state`, `joined`, `selectedCommunityID`, `timeline`, `isLoadingTimeline`, `joinHandleText`, `errorMessage`, `leaveConfirmation`. Test seams are three transports injected at **init** (`resolverTransport`/`membershipTransport`/`timelineTransport`, each defaulting to its client's `.defaultTransport`) — matching `FollowersModel`'s `followersTransport` init parameter and `MicrosubReaderModel`'s constructor-injection convention, not per-call-site closures.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteAppTests/CommunitiesModelTests.swift
import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("CommunitiesModel")
@MainActor
struct CommunitiesModelTests {
    /// In-memory `SecretStore` so `configure(site:)` can read a publish token without touching
    /// the Keychain — mirrors how `MicrosubReaderModel`'s own tests stub credential storage.
    final class InMemorySecretStore: SecretStore, @unchecked Sendable {
        var values: [String: String] = [:]
        func read(account: String) throws -> String? { values[account] }
        func write(_ value: String, account: String) throws { values[account] = value }
        func delete(account: String) throws { values.removeValue(forKey: account) }
    }

    /// Routes every request by exact URL to a canned (status, body). `CommunityActorResolver`,
    /// `CommunityMembershipClient`, and `GroupTimelineClient` all share the same `Transport`
    /// signature (`@Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)`), so this one
    /// fake — handed to all three init parameters — stands in for the whole network surface a
    /// test exercises: webfinger, the resolved actor document, this site's own outbox POST, and
    /// the joined community's outbox GET.
    actor FakeTransport {
        private var responses: [String: (status: Int, body: String)]
        private(set) var requestedURLs: [URL] = []

        init(_ responses: [String: (status: Int, body: String)] = [:]) {
            self.responses = responses
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            let url = request.url!
            requestedURLs.append(url)
            let (status, body) = responses[url.absoluteString] ?? (404, "not found")
            let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse) {
            { request in try await self.respond(to: request) }
        }
    }

    private static func site(configDirectory: URL, sourceDirectory: URL) -> CurrentSite {
        CurrentSite(
            id: "site-1", name: "Test Site",
            packageURL: sourceDirectory.deletingLastPathComponent(),
            sourceDirectory: sourceDirectory, configDirectory: configDirectory)
    }

    /// A fixture site directory with a `.site-config` declaring a public URL, so
    /// `DeployCoordinator.resolveSiteURL` resolves without a real deploy.
    private static func makeSiteDirectories() throws -> (config: URL, source: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-model-test-\(UUID().uuidString)")
        let config = root.appendingPathComponent("Config")
        let source = root.appendingPathComponent("Source")
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try "DOMAIN=example.com\n".write(
            to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return (config, source)
    }

    private static func model(secretStore: InMemorySecretStore, fake: FakeTransport) -> CommunitiesModel {
        CommunitiesModel(
            secretStore: secretStore,
            resolverTransport: fake.transport,
            membershipTransport: fake.transport,
            timelineTransport: fake.transport)
    }

    @Test("join resolves the handle, follows it, and records it in the ledger")
    func joinRecordsCommunity() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"
        let fake = FakeTransport([
            "https://lemmy.ml/c/birding": (200, """
                {"id":"https://lemmy.ml/c/birding","type":"Group","preferredUsername":"birding",
                 "name":"Birding","outbox":"https://lemmy.ml/c/birding/outbox"}
                """),
            "https://example.com/users/site/outbox":
                (202, #"{"id":"https://example.com/users/site/outbox/1"}"#),
        ])

        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        model.joinHandleText = "https://lemmy.ml/c/birding"

        await model.join()

        #expect(model.joined.count == 1)
        #expect(model.joined.first?.actorID.absoluteString == "https://lemmy.ml/c/birding")
        #expect(model.joined.first?.followActivityID == "https://example.com/users/site/outbox/1")
        #expect(model.joinHandleText.isEmpty)
        #expect(model.errorMessage == nil)

        // Persisted, not just in memory.
        let reloaded = CommunitiesLedger.load(from: config)
        #expect(reloaded?.communities.count == 1)
    }

    @Test("a resolver failure surfaces errorMessage and records nothing")
    func joinResolveFailureSurfacesError() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"
        let fake = FakeTransport(["https://lemmy.ml/c/ghost": (404, "not found")])

        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        model.joinHandleText = "https://lemmy.ml/c/ghost"

        await model.join()

        #expect(model.joined.isEmpty)
        #expect(model.errorMessage != nil)
    }

    @Test("confirmLeave unfollows and removes the community from the ledger")
    func confirmLeaveRemovesCommunity() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"

        var ledger = CommunitiesLedger()
        let community = JoinedCommunity(
            actorID: URL(string: "https://lemmy.ml/c/birding")!,
            outboxURL: URL(string: "https://lemmy.ml/c/birding/outbox")!,
            handle: "@birding@lemmy.ml", displayName: "Birding", joinedAt: Date(),
            followActivityID: "https://example.com/users/site/outbox/1")
        ledger.record(community)
        try ledger.save(to: config)

        let fake = FakeTransport(["https://example.com/users/site/outbox": (202, "{}")])
        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        #expect(model.joined.count == 1)

        model.requestLeave(community)
        #expect(model.leaveConfirmation == community)

        await model.confirmLeave()

        #expect(model.joined.isEmpty)
        #expect(model.leaveConfirmation == nil)
        #expect(CommunitiesLedger.load(from: config)?.communities.isEmpty == true)
    }

    @Test("loadTimeline populates from the selected community's outbox")
    func loadTimelinePopulates() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"

        var ledger = CommunitiesLedger()
        let community = JoinedCommunity(
            actorID: URL(string: "https://lemmy.ml/c/birding")!,
            outboxURL: URL(string: "https://lemmy.ml/c/birding/outbox")!,
            handle: "@birding@lemmy.ml", displayName: "Birding", joinedAt: Date(),
            followActivityID: nil)
        ledger.record(community)
        try ledger.save(to: config)

        let fake = FakeTransport([
            "https://lemmy.ml/c/birding/outbox": (200, """
                {"id":"https://lemmy.ml/c/birding/outbox","type":"OrderedCollection","totalItems":1,
                 "first":"https://lemmy.ml/c/birding/outbox?page=1"}
                """),
            "https://lemmy.ml/c/birding/outbox?page=1": (200, """
                {"id":"https://lemmy.ml/c/birding/outbox?page=1","type":"OrderedCollectionPage",
                 "orderedItems":[
                   {"id":"https://lemmy.ml/activities/1","type":"Create",
                    "object":{"id":"https://lemmy.ml/post/1","type":"Page","name":"Osprey sighting"}}
                 ]}
                """),
        ])
        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))

        // `selectCommunity` already fires `loadTimeline()` in a fire-and-forget `Task`; the
        // explicit `await` below is what the test actually waits on, so the redundant first load
        // is harmless (same fetch, same result) rather than a race.
        model.selectCommunity(community.id)
        await model.loadTimeline()

        #expect(model.timeline.count == 1)
        #expect(model.timeline.first?.title == "Osprey sighting")
        #expect(model.isLoadingTimeline == false)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter CommunitiesModelTests`
Expected: FAIL — "cannot find type 'CommunitiesModel' in scope"

- [ ] **Step 3: Implement `CommunitiesModel`**

```swift
// Sources/AnglesiteApp/CommunitiesModel.swift
import Foundation
import Observation
import AnglesiteCore

/// Drives the main-pane Communities view (Website ▸ Communities…, V-5.1a #368): resolve a handle
/// or URL, join/leave a fediverse `Group`, and read its public timeline. App glue only — protocol
/// logic lives in `AnglesiteCore` (`CommunityActorResolver`, `CommunityMembershipClient`,
/// `GroupTimelineClient`, `CommunitiesLedger`).
///
/// The three transports are injected at init — matching `FollowersModel.followersTransport`'s
/// constructor-injection convention, not a per-call-site closure — because each client
/// (`CommunityActorResolver`/`CommunityMembershipClient`/`GroupTimelineClient`) is still built
/// fresh per call around the *current* `ownActorURL`/`publishToken` (those can change if the site
/// is republished mid-session), but the transport underneath it stays fixed for the model's
/// lifetime, exactly like `followersTransport` does for `FollowersModel`'s client.
@MainActor
@Observable
final class CommunitiesModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case noSiteURL
        case notActivated
        case unreachable(String)
    }

    private(set) var state: State = .idle
    private(set) var joined: [JoinedCommunity] = []
    private(set) var selectedCommunityID: String?
    private(set) var timeline: [GroupPost] = []
    private(set) var isLoadingTimeline = false
    var joinHandleText = ""
    var errorMessage: String?
    /// Non-nil ⟺ the "Leave this community?" confirmation is showing — mirrors
    /// `SiteWindowModel.deleteConfirmation`'s item-based-confirmation pattern.
    var leaveConfirmation: JoinedCommunity?

    private var siteID: String?
    private var configDirectory: URL?
    private var siteURL: URL?
    private var ownActorURL: URL?
    private let secretStore: any SecretStore
    private let resolverTransport: CommunityActorResolver.Transport
    private let membershipTransport: CommunityMembershipClient.Transport
    private let timelineTransport: GroupTimelineClient.Transport

    init(
        secretStore: any SecretStore = PlatformSecretStore.make(),
        resolverTransport: @escaping CommunityActorResolver.Transport
            = CommunityActorResolver.defaultTransport,
        membershipTransport: @escaping CommunityMembershipClient.Transport
            = CommunityMembershipClient.defaultTransport,
        timelineTransport: @escaping GroupTimelineClient.Transport
            = GroupTimelineClient.defaultTransport
    ) {
        self.secretStore = secretStore
        self.resolverTransport = resolverTransport
        self.membershipTransport = membershipTransport
        self.timelineTransport = timelineTransport
    }

    /// Records which site this pane talks to and loads the joined-communities ledger from disk.
    /// No network I/O. Called once per site open from `SiteWindowModel.loadAndStart()`, mirroring
    /// `FollowersModel.configure(site:)`.
    func configure(site: CurrentSite) {
        siteID = site.id
        configDirectory = site.configDirectory
        joined = CommunitiesLedger.load(from: site.configDirectory)?.communities ?? []
        siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: site.sourceDirectory).flatMap { URL(string: $0) }
        ownActorURL = siteURL.map { ActivityPubActor.actorURL(siteURL: $0) }
        state = joined.isEmpty ? .idle : .loaded
    }

    private var publishToken: String? {
        guard let siteID else { return nil }
        return try? secretStore.read(account: SecretAccounts.activityPubPublishToken(siteID: siteID))
    }

    // MARK: - Join

    func join() async {
        let input = joinHandleText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }
        guard let ownActorURL, let publishToken else {
            errorMessage = "This site has no known public URL yet — deploy it at least once first."
            return
        }
        errorMessage = nil
        do {
            let resolved = try await CommunityActorResolver(transport: resolverTransport).resolve(input)
            let membership = CommunityMembershipClient(
                ownActorURL: ownActorURL, publishToken: publishToken, transport: membershipTransport)
            let activityID = try await membership.follow(target: resolved.actorID)
            let community = JoinedCommunity(
                actorID: resolved.actorID, outboxURL: resolved.outboxURL,
                handle: resolved.handle, displayName: resolved.name ?? resolved.preferredUsername,
                joinedAt: Date(), followActivityID: activityID)
            var ledger = CommunitiesLedger(communities: joined)
            ledger.record(community)
            joined = ledger.communities
            try? persist(ledger)
            joinHandleText = ""
            state = .loaded
        } catch {
            errorMessage = "Couldn't join \(input): \(error)"
        }
    }

    // MARK: - Leave

    func requestLeave(_ community: JoinedCommunity) {
        leaveConfirmation = community
    }

    func cancelLeave() {
        leaveConfirmation = nil
    }

    func confirmLeave() async {
        guard let community = leaveConfirmation else { return }
        guard let ownActorURL, let publishToken else {
            errorMessage = "This site has no known public URL yet — deploy it at least once first."
            leaveConfirmation = nil
            return
        }
        do {
            let membership = CommunityMembershipClient(
                ownActorURL: ownActorURL, publishToken: publishToken, transport: membershipTransport)
            try await membership.unfollow(
                target: community.actorID, followActivityID: community.followActivityID)
            var ledger = CommunitiesLedger(communities: joined)
            ledger.remove(actorID: community.actorID)
            joined = ledger.communities
            try? persist(ledger)
            if selectedCommunityID == community.id {
                selectedCommunityID = nil
                timeline = []
            }
            leaveConfirmation = nil
        } catch {
            errorMessage = "Couldn't leave \(community.displayName ?? community.id): \(error)"
            leaveConfirmation = nil
        }
    }

    private func persist(_ ledger: CommunitiesLedger) throws {
        guard let configDirectory else { return }
        try ledger.save(to: configDirectory)
    }

    // MARK: - Timeline

    func selectCommunity(_ id: String) {
        guard id != selectedCommunityID else { return }
        selectedCommunityID = id
        timeline = []
        Task { await loadTimeline() }
    }

    func loadTimeline() async {
        guard let selectedCommunityID,
              let community = joined.first(where: { $0.id == selectedCommunityID }),
              let outboxURL = community.outboxURL
        else { return }
        isLoadingTimeline = true
        defer { isLoadingTimeline = false }
        let client = GroupTimelineClient(transport: timelineTransport)
        do {
            let head = try await client.collection(at: outboxURL)
            guard let firstPage = head.firstPage else {
                timeline = []
                return
            }
            let page = try await client.page(at: firstPage)
            timeline = page.items
        } catch {
            errorMessage = "Couldn't load \(community.displayName ?? community.id)'s timeline: \(error)"
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter CommunitiesModelTests`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/CommunitiesModel.swift Tests/AnglesiteAppTests/CommunitiesModelTests.swift
git commit -m "feat(#368): add CommunitiesModel to orchestrate join/leave/timeline"
```

---

### Task 6: `CommunitiesView` — the SwiftUI pane

**Files:**
- Create: `Sources/AnglesiteApp/CommunitiesView.swift`

**Interfaces:**
- Consumes: `CommunitiesModel` (Task 5)'s full public surface.
- Produces: `struct CommunitiesView: View { @Bindable var communities: CommunitiesModel }`, used by Task 7's `SiteWindow.swift` switch case.

- [ ] **Step 1: Implement `CommunitiesView`**

No test file — this is a SwiftUI layout, like `FollowersView`/`MicrosubReaderView`, neither of which has a dedicated test file; behavior lives in the already-tested `CommunitiesModel`. Verified instead by the manual QA in Task 8.

```swift
// Sources/AnglesiteApp/CommunitiesView.swift
import SwiftUI
import AppKit
import AnglesiteCore

/// Main-pane Communities surface (Website ▸ Communities…, V-5.1a #368): join/leave fediverse
/// Group actors and read a per-group timeline. Mirrors `FollowersView`/`MicrosubReaderView`'s
/// wiring shape — a dedicated pane with its own model, no in-content pane picker.
struct CommunitiesView: View {
    @Bindable var communities: CommunitiesModel

    var body: some View {
        HSplitView {
            sidebar
                .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            timelinePane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationSubtitle("Communities")
        .alert(
            "Communities error",
            isPresented: Binding(
                get: { communities.errorMessage != nil },
                set: { if !$0 { communities.errorMessage = nil } }),
            presenting: communities.errorMessage
        ) { _ in
            Button("OK", role: .cancel) { communities.errorMessage = nil }
        } message: { message in
            Text(message)
        }
        .alert(
            "Leave this community?",
            isPresented: Binding(
                get: { communities.leaveConfirmation != nil },
                set: { if !$0 { communities.cancelLeave() } }),
            presenting: communities.leaveConfirmation
        ) { community in
            Button("Leave", role: .destructive) { Task { await communities.confirmLeave() } }
            Button("Cancel", role: .cancel) { communities.cancelLeave() }
        } message: { community in
            Text("This site will stop receiving posts from \(community.displayName ?? community.id).")
        }
    }

    @ViewBuilder
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TextField("!community@instance or URL", text: $communities.joinHandleText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await communities.join() } }
                Button("Join") { Task { await communities.join() } }
                    .disabled(communities.joinHandleText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding()

            if communities.joined.isEmpty {
                Text("No communities joined yet — enter a handle above, like !birding@lemmy.ml.")
                    .foregroundStyle(.secondary)
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                List(selection: Binding(
                    get: { communities.selectedCommunityID },
                    set: { if let id = $0 { communities.selectCommunity(id) } }
                )) {
                    ForEach(communities.joined) { community in
                        communityRow(community).tag(community.id)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func communityRow(_ community: JoinedCommunity) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(community.displayName ?? community.handle ?? community.actorID.absoluteString)
                .font(.headline)
                .lineLimit(1)
            if let handle = community.handle {
                Text(handle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .contextMenu {
            Button("Leave…", role: .destructive) { communities.requestLeave(community) }
        }
    }

    @ViewBuilder
    private var timelinePane: some View {
        if communities.selectedCommunityID == nil {
            Text("Select a community to see its timeline.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if communities.isLoadingTimeline {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if communities.timeline.isEmpty {
            Text("No posts yet.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(communities.timeline) { post in
                timelineRow(post)
            }
        }
    }

    @ViewBuilder
    private func timelineRow(_ post: GroupPost) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(post.title ?? post.contentHTML ?? post.id)
                .font(.headline)
                .lineLimit(2)
            if let author = post.authorName {
                Text(author).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .contextMenu {
            if let url = post.url {
                Button("Open in Browser") { NSWorkspace.shared.open(url) }
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add Sources/AnglesiteApp/CommunitiesView.swift
git commit -m "feat(#368): add the Communities pane's SwiftUI layout"
```

---

### Task 7: Wire Communities into the site window

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:9-16` (the `MainPaneMode` enum), `Sources/AnglesiteApp/SiteWindowModel.swift:139-142` (child model declarations), `Sources/AnglesiteApp/SiteWindowModel.swift:298-307` (`presentFollowers()`), `Sources/AnglesiteApp/SiteWindowModel.swift:1528-1529` (`loadAndStart()`'s configure calls)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift:770-773` (the main-pane switch)
- Modify: `Sources/AnglesiteApp/WebsiteCommands.swift:55-59` (the Website menu)

**Interfaces:**
- Consumes: `CommunitiesModel` (Task 5), `CommunitiesView` (Task 6).

- [ ] **Step 1: Add the `.communities` pane mode**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, extend the enum:

```swift
enum MainPaneMode: Equatable {
    case preview
    case editor(FileRef)
    case graph
    case cleanup        // Site ▸ Cleanup… (#714 moved it out of the sidebar)
    case reader         // Website ▸ Reader… (V-4.3, #365)
    case followers      // Website ▸ Followers… (V-4.2, #364)
    case communities    // Website ▸ Communities… (V-5.1a, #368)
}
```

- [ ] **Step 2: Add the child model**

Immediately after the existing `followers` declaration:

```swift
    /// Drives the main-pane Followers view (Website ▸ Followers…, V-4.2 #364): the site's public
    /// ActivityPub followers collection, with lazily-enriched display identities.
    var followers = FollowersModel()
    /// Drives the main-pane Communities view (Website ▸ Communities…, V-5.1a #368): join/leave
    /// fediverse Group actors and read a per-group timeline.
    var communities = CommunitiesModel()
```

- [ ] **Step 3: Add `presentCommunities()`**

Immediately after `presentFollowers()`:

```swift
    /// Switches the main pane to Communities (Website ▸ Communities…, V-5.1a #368). Mirrors
    /// `presentFollowers()`'s leave-current-surface-first guard.
    func presentCommunities() {
        Task {
            guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
            activeEditor = nil
            inspectorContext = nil
            mainPaneMode = .communities
        }
    }
```

- [ ] **Step 4: Configure it on site open**

In `loadAndStart()`, immediately after the existing configure calls:

```swift
        reader.configure(site: currentSite)
        followers.configure(site: currentSite)
        communities.configure(site: currentSite)
```

- [ ] **Step 5: Add the main-pane switch case**

In `Sources/AnglesiteApp/SiteWindow.swift`, immediately after the `.followers` case (line 773):

```swift
        case .reader:
            MicrosubReaderView(reader: model.reader)
        case .followers:
            FollowersView(followers: model.followers)
        case .communities:
            CommunitiesView(communities: model.communities)
```

- [ ] **Step 6: Add the Website menu item**

In `Sources/AnglesiteApp/WebsiteCommands.swift`, immediately after the `Followers…` button:

```swift
            Button("Followers…") { model?.presentFollowers() }
                .disabled(model == nil)

            Button("Communities…") { model?.presentCommunities() }
                .disabled(model == nil)
```

- [ ] **Step 7: Regenerate the Xcode project and build**

`Sources/AnglesiteApp/CommunitiesModel.swift`/`CommunitiesView.swift` are new files under a path XcodeGen already globs (`Sources/AnglesiteApp/**`), so no `project.yml` change is needed — but the gitignored `.xcodeproj` must still be regenerated to pick them up.

Run: `xcodegen generate`
Expected: regenerates `Anglesite.xcodeproj` without error.

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED

- [ ] **Step 8: Run the full test suite**

Run: `swift test --package-path .`
Expected: all suites PASS, including the five new ones from Tasks 1–5.

- [ ] **Step 9: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift Sources/AnglesiteApp/SiteWindow.swift Sources/AnglesiteApp/WebsiteCommands.swift
git commit -m "feat(#368): wire the Communities pane into the site window"
```

---

### Task 8: Manual acceptance

**Files:** none — this is verification, not code.

The issue's acceptance criteria ("join a Lemmy community by handle from the app; its posts appear in the group timeline; leaving stops delivery") need a real Lemmy peer and a deployed site, so they aren't automatable inline — same constraint the design spec's own test-strategy section notes. `AppliesEditEndToEndTests`-style container-gated e2e (`ANGLESITE_CONTAINER_E2E=1`) against the composed Worker is a reasonable fast-follow but is **out of scope for this plan**: it needs its own container-fixture design (a deployed test site plus a live or fixture Lemmy peer) that would meaningfully bloat this PR. Flag it explicitly rather than silently dropping it — either as a follow-up issue or a note in the PR body's Test plan.

- [ ] **Step 1: Manual QA against a real site**

1. Open (or create) a site with ActivityPub turned on and already published (Settings ▸ Workers).
2. Website ▸ Communities…
3. Enter `!<some active Lemmy community>@<lemmy instance>` (e.g. a real, small, active community — check `https://join-lemmy.org/instances` for one) and click Join.
4. Confirm the community appears in the sidebar list and its timeline loads with recent posts.
5. Context-menu ▸ Leave…, confirm. Confirm the community disappears from the list and the timeline pane returns to "Select a community…".
6. Quit and reopen the site window; confirm the joined-communities list survived (persisted in `Config/activitypub-communities.json`) until the Leave step ran.

Record the outcome (pass/fail + any deviations) in the PR body's Test plan section.

---

## Self-Review Notes

- **Spec coverage:** Join (#368 plan item 1) → Tasks 1–2 + `CommunitiesModel.join()`. Communities section (item 2) → Tasks 5–7. Per-group timeline (item 3) → Task 3 + `CommunitiesModel.loadTimeline()`. Leave (item 4) → Task 2's `unfollow` + `CommunitiesModel.confirmLeave()`. Swift Testing against a stubbed client (test strategy) → Tasks 1–5's suites. Manual acceptance against a live Lemmy community → Task 8. Container-gated e2e is explicitly called out as deferred, not silently dropped.
- **Out of scope, called out, not silently dropped:** posting to a community (`audience` field, #369) and directory browse/search (#371) — neither appears in any task above; #368's own issue body doesn't ask for them either.
- **Type consistency check:** `ResolvedCommunityActor.actorID`/`.outboxURL` (Task 1) flow unchanged into `JoinedCommunity.actorID`/`.outboxURL` (Task 4) and `CommunityMembershipClient.follow(target:)`'s `target: URL` (Task 2). `CommunityMembershipClient.follow(target:)`'s returned `String` flows into `JoinedCommunity.followActivityID` and back into `unfollow(target:followActivityID:)`. `GroupTimelineClient.page(at:)`'s `GroupTimelinePage.items: [GroupPost]` flows unchanged into `CommunitiesModel.timeline` and `CommunitiesView`'s `ForEach`.
