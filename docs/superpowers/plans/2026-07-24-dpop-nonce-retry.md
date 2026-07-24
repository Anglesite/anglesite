# DPoP-nonce challenge/retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SiteIndieAuthClient.exchange` and `MicrosubClient`'s request path handle an RFC 9449 §8 DPoP-nonce challenge (`use_dpop_nonce` + `DPoP-Nonce` header) by retrying exactly once with a fresh proof that echoes the nonce.

**Architecture:** A shared, pure `DPoPNonceChallenge.nonce(in:response:)` helper detects the challenge shape; `DPoPKeyPair.proof` gains an optional `nonce` param to embed it in the retried proof's JWT payload; both clients build their request as data (so it can be re-signed) and send it through a one-retry-then-decode path.

**Tech Stack:** Swift 6.4, Swift Testing (`@Test`/`@Suite`/`#expect`), `@testable import AnglesiteCore`, injected `Transport` closures (no real networking in tests).

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-24-dpop-nonce-retry-design.md](../specs/2026-07-24-dpop-nonce-retry-design.md)
- Challenge shape (RFC 9449 §8, confirmed against `@dwk/dpop`): HTTP status 400 or 401, JSON body `{"error": "use_dpop_nonce"}`, response header `DPoP-Nonce: <nonce>` — all three must hold, else it's an ordinary failure.
- Cap at exactly one retry. No loops, no recursion beyond a single extra send.
- No new mutable state on `SiteIndieAuthClient`/`MicrosubClient` — both stay immutable `Sendable` structs (the "cache the nonce" alternative was explicitly rejected in the spec).
- `DPoPKeyPair.proof`'s new `nonce` parameter defaults to `nil` — every existing call site must keep compiling unchanged.
- Tests run via `swift test --package-path .` (`AnglesiteCoreTests` target) — no Xcode build needed for this work.

---

## File Structure

- **Modify** `Sources/AnglesiteCore/DPoPKeyPair.swift` — add `nonce` param to `proof`; add new `DPoPNonceChallenge` enum (shared detector, used by both clients below).
- **Modify** `Sources/AnglesiteCore/SiteIndieAuthClient.swift` — `exchange` retries once on a nonce challenge.
- **Modify** `Sources/AnglesiteCore/MicrosubClient.swift` — `get`/`post` route through a shared `sendAuthorized` that retries once on a nonce challenge.
- **Modify** `Tests/AnglesiteCoreTests/DPoPKeyPairTests.swift` — nonce-claim tests + new `DPoPNonceChallengeTests` suite.
- **Modify** `Tests/AnglesiteCoreTests/SiteIndieAuthClientTests.swift` — nonce-retry tests for `exchange`.
- **Modify** `Tests/AnglesiteCoreTests/MicrosubClientTests.swift` — nonce-retry tests for `listChannels` (GET) and `follow` (POST).

---

### Task 1: `DPoPKeyPair.proof(nonce:)` + shared `DPoPNonceChallenge` detector

**Files:**
- Modify: `Sources/AnglesiteCore/DPoPKeyPair.swift`
- Test: `Tests/AnglesiteCoreTests/DPoPKeyPairTests.swift`

**Interfaces:**
- Produces: `DPoPKeyPair.proof(htm: String, htu: String, accessToken: String? = nil, nonce: String? = nil) throws -> String` — adds `nonce`, backward compatible.
- Produces: `enum DPoPNonceChallenge { static func nonce(in data: Data, response http: HTTPURLResponse) -> String? }` (internal, in `AnglesiteCore`) — used by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteCoreTests/DPoPKeyPairTests.swift`, inside the existing `#if canImport(CryptoKit)` block (after `proofAccessTokenHash`), add:

```swift
@Test("proof(nonce:) carries the nonce claim when passed")
func proofNonceClaim() throws {
    let keyPair = DPoPKeyPair()
    let proof = try keyPair.proof(htm: "POST", htu: "https://owner.example/token", nonce: "server-nonce-1")
    let segments = proof.split(separator: ".", omittingEmptySubsequences: false)
    let payload = jsonSegment(String(segments[1]))
    #expect(payload["nonce"] as? String == "server-nonce-1")
}

@Test("proof omits the nonce claim by default")
func proofNoNonceByDefault() throws {
    let keyPair = DPoPKeyPair()
    let proof = try keyPair.proof(htm: "POST", htu: "https://owner.example/token")
    let segments = proof.split(separator: ".", omittingEmptySubsequences: false)
    let payload = jsonSegment(String(segments[1]))
    #expect(payload["nonce"] == nil)
}
```

Then, at the end of the file (after the closing `}` of `DPoPKeyPairTests`, still before EOF), add a new suite that needs no CryptoKit — it only tests the pure data/response detector:

```swift
/// Tests `DPoPNonceChallenge`'s RFC 9449 §8 detection: it must require all three of status
/// 400/401, a `use_dpop_nonce` error body, and a non-empty `DPoP-Nonce` header before treating a
/// response as a challenge — anything less is an ordinary failure the caller handles as today.
@Suite
struct DPoPNonceChallengeTests {
    private let url = URL(string: "https://owner.example/token")!

    private func response(_ code: Int, headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: headers)!
    }

    @Test("matches a 400 with use_dpop_nonce error and a DPoP-Nonce header")
    func matchesChallenge() {
        let data = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let http = response(400, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == "nonce-abc")
    }

    @Test("matches a 401 with use_dpop_nonce error and a DPoP-Nonce header")
    func matchesChallengeOn401() {
        let data = Data(#"{"error":"use_dpop_nonce","error_description":"nonce required"}"#.utf8)
        let http = response(401, headers: ["DPoP-Nonce": "nonce-xyz"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == "nonce-xyz")
    }

    @Test("does not match a 400 with a different error, even with a DPoP-Nonce header")
    func ignoresOtherErrors() {
        let data = Data(#"{"error":"invalid_dpop_proof"}"#.utf8)
        let http = response(400, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }

    @Test("does not match use_dpop_nonce without a DPoP-Nonce header")
    func ignoresMissingHeader() {
        let data = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let http = response(400)
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }

    @Test("does not match on a 403 even with the right body and header")
    func ignoresWrongStatus() {
        let data = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let http = response(403, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }

    @Test("does not match a 200 success response")
    func ignoresSuccess() {
        let data = Data(#"{"access_token":"tok"}"#.utf8)
        let http = response(200, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DPoPKeyPairTests`
Expected: FAIL to compile — `proof(htm:htu:nonce:)` has no `nonce` argument, and `DPoPNonceChallenge` is unknown.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/DPoPKeyPair.swift`, replace the `proof` method:

```swift
    /// Builds and signs a DPoP proof JWT (RFC 9449 §4.2) for one HTTP request: a fresh `jti`/
    /// `iat`, `htm`/`htu` binding it to this request, and — when `accessToken` is supplied — the
    /// `ath` claim binding it to that specific bearer token (required on every resource request;
    /// omit for the token-endpoint exchange, which has no token yet). `nonce` echoes a
    /// server-issued `DPoP-Nonce` (RFC 9449 §8) on a retried proof; omit on the first attempt.
    public func proof(htm: String, htu: String, accessToken: String? = nil, nonce: String? = nil) throws -> String {
        #if canImport(CryptoKit)
        let header: [String: Any] = ["typ": "dpop+jwt", "alg": "ES256", "jwk": publicJWK]
        var payload: [String: Any] = [
            "jti": UUID().uuidString,
            "htm": htm,
            "htu": htu,
            "iat": Int(Date().timeIntervalSince1970),
        ]
        if let accessToken {
            payload["ath"] = Self.base64URL(Data(SHA256.hash(data: Data(accessToken.utf8))))
        }
        if let nonce {
            payload["nonce"] = nonce
        }
        let headerSegment = try Self.base64URLJSON(header)
        let payloadSegment = try Self.base64URLJSON(payload)
        let signingInput = Data("\(headerSegment).\(payloadSegment)".utf8)
        let signature = try privateKey.signature(for: signingInput)
        return "\(headerSegment).\(payloadSegment).\(Self.base64URL(signature.rawRepresentation))"
        #else
        // DPoP signing needs CryptoKit (Apple platforms only) — there's no sign-in UI on a
        // platform without it either (matches CloudflareOAuthClient.codeChallenge(for:)'s posture).
        throw DPoPError.unavailable
        #endif
    }
```

Then, after the `DPoPError` enum at the end of the file, append:

```swift

/// Detects an RFC 9449 §8 DPoP-nonce challenge: a 400/401 response carrying `error:
/// "use_dpop_nonce"` and a `DPoP-Nonce` response header with the nonce the retried proof's
/// `nonce` claim must echo. Shared by `SiteIndieAuthClient` and `MicrosubClient` so both clients
/// agree on what counts as a challenge — any other 4xx/5xx (including a bare `invalid_dpop_proof`
/// with no nonce header) falls through to the caller's ordinary failure handling.
enum DPoPNonceChallenge {
    static func nonce(in data: Data, response http: HTTPURLResponse) -> String? {
        guard http.statusCode == 400 || http.statusCode == 401 else { return nil }
        guard let nonce = http.value(forHTTPHeaderField: "DPoP-Nonce"), !nonce.isEmpty else { return nil }
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              object["error"] as? String == "use_dpop_nonce"
        else { return nil }
        return nonce
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter DPoPKeyPairTests`
Expected: PASS (all tests in `DPoPKeyPairTests` and the new `DPoPNonceChallengeTests`)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DPoPKeyPair.swift Tests/AnglesiteCoreTests/DPoPKeyPairTests.swift
git commit -m "feat(#936): add DPoP nonce claim + RFC 9449 §8 challenge detector"
```

---

### Task 2: `SiteIndieAuthClient.exchange` retries once on a nonce challenge

**Files:**
- Modify: `Sources/AnglesiteCore/SiteIndieAuthClient.swift:191-231` (the `exchange` method)
- Test: `Tests/AnglesiteCoreTests/SiteIndieAuthClientTests.swift`

**Interfaces:**
- Consumes: `DPoPKeyPair.proof(htm:htu:accessToken:nonce:)`, `DPoPNonceChallenge.nonce(in:response:)` (Task 1).
- Produces: `SiteIndieAuthClient.exchange(code:for:dpopKeyPair:) async throws -> SiteIndieAuthToken` — same public signature as today; retry is internal.

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteCoreTests/SiteIndieAuthClientTests.swift`, inside the existing `#if canImport(CryptoKit)` block (after `exchangeParsesToken`), add:

```swift
@Test("exchange retries once with the echoed nonce after a use_dpop_nonce challenge")
func exchangeRetriesOnNonceChallenge() async throws {
    let request = makeRequest()
    let dpopKeyPair = DPoPKeyPair()
    var capturedDPoPHeaders: [String] = []
    var transportCallCount = 0
    let client = SiteIndieAuthClient(transport: { req in
        transportCallCount += 1
        capturedDPoPHeaders.append(req.value(forHTTPHeaderField: "DPoP") ?? "")
        if transportCallCount == 1 {
            let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
            let http = HTTPURLResponse(
                url: request.tokenEndpoint, statusCode: 400, httpVersion: nil,
                headerFields: ["DPoP-Nonce": "server-nonce-1"]
            )!
            return (challenge, http)
        }
        let body = #"{"access_token":"tok-123","token_type":"DPoP","scope":"read","me":"https://owner.example/","expires_in":3600}"#
        return (Data(body.utf8), self.response(200))
    })

    let token = try await client.exchange(code: "auth-code", for: request, dpopKeyPair: dpopKeyPair)

    #expect(token.accessToken == "tok-123")
    #expect(transportCallCount == 2)

    func base64urlDecode(_ segment: Substring) -> Data {
        var base64 = segment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        return Data(base64Encoded: base64) ?? Data()
    }
    let firstPayload = try JSONSerialization.jsonObject(
        with: base64urlDecode(capturedDPoPHeaders[0].split(separator: ".")[1])
    ) as! [String: Any]
    #expect(firstPayload["nonce"] == nil)

    let retryPayload = try JSONSerialization.jsonObject(
        with: base64urlDecode(capturedDPoPHeaders[1].split(separator: ".")[1])
    ) as! [String: Any]
    #expect(retryPayload["nonce"] as? String == "server-nonce-1")
}

@Test("exchange caps at one retry — a repeated nonce challenge still throws .tokenExchangeFailed")
func exchangeCapsRetryAtOne() async {
    let request = makeRequest()
    var transportCallCount = 0
    let client = SiteIndieAuthClient(transport: { _ in
        transportCallCount += 1
        let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let http = HTTPURLResponse(
            url: request.tokenEndpoint, statusCode: 400, httpVersion: nil,
            headerFields: ["DPoP-Nonce": "server-nonce-\(transportCallCount)"]
        )!
        return (challenge, http)
    })

    await #expect(throws: SiteIndieAuthError.self) {
        _ = try await client.exchange(code: "auth-code", for: request, dpopKeyPair: DPoPKeyPair())
    }
    #expect(transportCallCount == 2)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SiteIndieAuthClientTests`
Expected: FAIL — `transportCallCount == 2` assertions fail (today's `exchange` sends exactly once and surfaces the 400 as `.tokenExchangeFailed` on the first call, so `exchangeRetriesOnNonceChallenge` fails decoding a token and `exchangeCapsRetryAtOne` fails because it expects `transportCallCount == 2` but gets `1`).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/SiteIndieAuthClient.swift`, replace the entire `exchange` method (currently lines 191-231, from `public func exchange(` through its closing `}` right before `private func discoverMetadata`):

```swift
    /// Exchanges `code` for a DPoP-bound access token, proving possession of `dpopKeyPair` at the
    /// token endpoint (RFC 9449 §5) — the same key pair must sign every later resource-request
    /// proof, since the minted token's `cnf.jkt` binds to it. Retries exactly once, with a fresh
    /// proof echoing the nonce, if the server answers with an RFC 9449 §8 `use_dpop_nonce`
    /// challenge — anything else (including a second challenge) surfaces as
    /// `.tokenExchangeFailed`.
    public func exchange(
        code: String,
        for request: SiteIndieAuthRequest,
        dpopKeyPair: DPoPKeyPair
    ) async throws -> SiteIndieAuthToken {
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: request.clientID.absoluteString),
            URLQueryItem(name: "redirect_uri", value: request.redirectURI.absoluteString),
            URLQueryItem(name: "code_verifier", value: request.codeVerifier),
        ]
        let bodyData = Data((form.percentEncodedQuery ?? "").utf8)

        func makeRequest(nonce: String?) throws -> URLRequest {
            var urlRequest = URLRequest(url: request.tokenEndpoint)
            urlRequest.httpMethod = "POST"
            urlRequest.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = bodyData
            do {
                urlRequest.setValue(
                    try dpopKeyPair.proof(htm: "POST", htu: request.tokenEndpoint.absoluteString, nonce: nonce),
                    forHTTPHeaderField: "DPoP"
                )
            } catch is DPoPError {
                throw SiteIndieAuthError.dpopUnavailable
            }
            return urlRequest
        }

        var (data, http) = try await send(makeRequest(nonce: nil))
        if let nonce = DPoPNonceChallenge.nonce(in: data, response: http) {
            (data, http) = try await send(makeRequest(nonce: nonce))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SiteIndieAuthError.tokenExchangeFailed("HTTP \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        do {
            return try JSONDecoder().decode(SiteIndieAuthToken.self, from: data)
        } catch {
            throw SiteIndieAuthError.tokenExchangeFailed("bad response: \(error)")
        }
    }

    private func send(_ urlRequest: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await transport(urlRequest)
        } catch {
            throw SiteIndieAuthError.tokenExchangeFailed(error.localizedDescription)
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter SiteIndieAuthClientTests`
Expected: PASS (all tests, including the pre-existing ones — `exchangeParsesToken`'s `transportCallCount == 1` assertion still holds since a 200 response never triggers `DPoPNonceChallenge`)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteIndieAuthClient.swift Tests/AnglesiteCoreTests/SiteIndieAuthClientTests.swift
git commit -m "feat(#936): retry SiteIndieAuthClient.exchange once on DPoP nonce challenge"
```

---

### Task 3: `MicrosubClient` retries once on a nonce challenge

**Files:**
- Modify: `Sources/AnglesiteCore/MicrosubClient.swift:134-198` (the "Request plumbing" section: `get`, `post`, `postDiscardingResponse`, `authorize`, `send`)
- Test: `Tests/AnglesiteCoreTests/MicrosubClientTests.swift`

**Interfaces:**
- Consumes: `DPoPKeyPair.proof(htm:htu:accessToken:nonce:)`, `DPoPNonceChallenge.nonce(in:response:)` (Task 1).
- Produces: no public API change — `listChannels`, `createChannel`, `follow`, `unfollow`, `timeline`, `markRead` keep their existing signatures; the retry is internal to the shared `sendAuthorized` path.

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteCoreTests/MicrosubClientTests.swift`, inside the existing `#if canImport(CryptoKit)` block (after `listChannelsDecodesResponse`), add:

```swift
@Test("listChannels retries once with the echoed nonce after a use_dpop_nonce challenge")
func listChannelsRetriesOnNonceChallenge() async throws {
    var capturedDPoPHeaders: [String] = []
    var transportCallCount = 0
    let client = MicrosubClient(
        endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
        transport: { request in
            transportCallCount += 1
            capturedDPoPHeaders.append(request.value(forHTTPHeaderField: "DPoP") ?? "")
            if transportCallCount == 1 {
                let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
                let http = HTTPURLResponse(
                    url: self.endpoint, statusCode: 401, httpVersion: nil,
                    headerFields: ["DPoP-Nonce": "server-nonce-1"]
                )!
                return (challenge, http)
            }
            let body = #"{"channels":[{"uid":"c1","name":"Blogs","unread":3}]}"#
            return (Data(body.utf8), self.response(200))
        }
    )

    let channels = try await client.listChannels()

    #expect(channels == [MicrosubChannel(uid: "c1", name: "Blogs", unread: 3)])
    #expect(transportCallCount == 2)

    func base64urlDecode(_ segment: Substring) -> Data {
        var base64 = segment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        return Data(base64Encoded: base64) ?? Data()
    }
    let retryPayload = try JSONSerialization.jsonObject(
        with: base64urlDecode(capturedDPoPHeaders[1].split(separator: ".")[1])
    ) as! [String: Any]
    #expect(retryPayload["nonce"] as? String == "server-nonce-1")
}

@Test("follow (POST) retries once with the echoed nonce, resending the same body")
func followRetriesOnNonceChallenge() async throws {
    var transportCallCount = 0
    var capturedBodies: [Data] = []
    let client = MicrosubClient(
        endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
        transport: { request in
            transportCallCount += 1
            capturedBodies.append(request.httpBody ?? Data())
            if transportCallCount == 1 {
                let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
                let http = HTTPURLResponse(
                    url: self.endpoint, statusCode: 401, httpVersion: nil,
                    headerFields: ["DPoP-Nonce": "server-nonce-2"]
                )!
                return (challenge, http)
            }
            return (Data("{}".utf8), self.response(200))
        }
    )

    try await client.follow(url: "https://feed.example/atom.xml", channel: "c1")

    #expect(transportCallCount == 2)
    #expect(capturedBodies[0] == capturedBodies[1])
}

@Test("a repeated nonce challenge still throws — caps at one retry")
func capsRetryAtOne() async {
    var transportCallCount = 0
    let client = MicrosubClient(
        endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
        transport: { _ in
            transportCallCount += 1
            let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
            let http = HTTPURLResponse(
                url: self.endpoint, statusCode: 401, httpVersion: nil,
                headerFields: ["DPoP-Nonce": "server-nonce-\(transportCallCount)"]
            )!
            return (challenge, http)
        }
    )

    await #expect(throws: MicrosubError.self) {
        _ = try await client.listChannels()
    }
    #expect(transportCallCount == 2)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter MicrosubClientTests`
Expected: FAIL — today's `get`/`post` send exactly once, so `transportCallCount == 2` assertions fail and `listChannelsRetriesOnNonceChallenge`/`followRetriesOnNonceChallenge` throw `.requestFailed` instead of succeeding.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/MicrosubClient.swift`, replace the entire "MARK: - Request plumbing" section — from `private func get<Response: Decodable>(query:` through the end of the old `private func send<Response: Decodable>(_ request: URLRequest) async throws -> Response { ... }` method (i.e. everything between `// MARK: - Request plumbing` and `/// Production transport:`) with:

```swift
    // MARK: - Request plumbing

    private func get<Response: Decodable>(query: [URLQueryItem]) async throws -> Response {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw MicrosubError.decodingFailed("malformed endpoint URL")
        }
        components.queryItems = query
        guard let url = components.url else {
            throw MicrosubError.decodingFailed("couldn't build request URL")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        return try await sendAuthorized(request, method: "GET")
    }

    private func post<Response: Decodable>(action: String, body: [String: Any]) async throws -> Response {
        var payload = body
        payload["action"] = action
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        return try await sendAuthorized(request, method: "POST")
    }

    /// For actions whose response body carries nothing the caller needs (`{}` on success).
    private func postDiscardingResponse(action: String, body: [String: Any]) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await post(action: action, body: body)
    }

    /// Signs and sends `request` and — on an RFC 9449 §8 `use_dpop_nonce` challenge — retries
    /// exactly once with a fresh proof echoing the nonce, before applying the ordinary
    /// status/decode checks. Every microsub action (`get`/`post` above) funnels through here, so
    /// the retry applies uniformly to every action, GET and POST alike.
    private func sendAuthorized<Response: Decodable>(_ request: URLRequest, method: String) async throws -> Response {
        var (data, http) = try await authorizedSend(request, method: method, nonce: nil)
        if let nonce = DPoPNonceChallenge.nonce(in: data, response: http) {
            (data, http) = try await authorizedSend(request, method: method, nonce: nonce)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw MicrosubError.requestFailed(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw MicrosubError.decodingFailed("\(error)")
        }
    }

    private func authorizedSend(_ request: URLRequest, method: String, nonce: String?) async throws -> (Data, HTTPURLResponse) {
        var signedRequest = request
        try authorize(&signedRequest, method: method, nonce: nonce)
        do {
            return try await transport(signedRequest)
        } catch {
            throw MicrosubError.requestFailed(status: 0, body: error.localizedDescription)
        }
    }

    /// Attaches the `Authorization: DPoP <token>` and `DPoP: <proof>` headers RFC 9449 requires —
    /// every microsub action is authorized this way, GET and POST alike (`auth.ts`'s `authorize`
    /// always passes `accessToken` to `verifyDpopProof`, so `ath` is never optional here). The
    /// proof's `htu` is the bare endpoint URL (no query) — matching the server's
    /// `expectedHtu: config.microsubEndpoint`, which `verifyDpopProof`'s own `normalizeHtu` would
    /// strip a query string from regardless. `nonce` echoes a prior RFC 9449 §8 challenge on
    /// retry (`authorizedSend`'s job to supply it); omitted on the first attempt.
    private func authorize(_ request: inout URLRequest, method: String, nonce: String? = nil) throws {
        request.setValue("DPoP \(accessToken)", forHTTPHeaderField: "Authorization")
        do {
            let proof = try dpopKeyPair.proof(htm: method, htu: endpoint.absoluteString, accessToken: accessToken, nonce: nonce)
            request.setValue(proof, forHTTPHeaderField: "DPoP")
        } catch is DPoPError {
            throw MicrosubError.dpopUnavailable
        }
    }
```

This removes the old standalone `send<Response: Decodable>(_ request: URLRequest) async throws -> Response` method — its status-check/decode logic now lives in `sendAuthorized`, and its transport-error handling now lives in `authorizedSend`. The `/// Production transport:` doc comment and `defaultTransport` static property below stay unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter MicrosubClientTests`
Expected: PASS (all tests, including pre-existing ones — e.g. `nonSuccessStatusThrows`'s single 403 response never matches `DPoPNonceChallenge`, since 403 isn't 400/401, so it still throws `.requestFailed` after exactly one call)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/MicrosubClient.swift Tests/AnglesiteCoreTests/MicrosubClientTests.swift
git commit -m "feat(#936): retry MicrosubClient requests once on DPoP nonce challenge"
```

---

### Task 4: Full-suite verification and PR

**Files:** none (verification only)

**Interfaces:** none — this task only runs the full test suite and prepares the PR.

- [ ] **Step 1: Run the full AnglesiteCore test suite**

Run: `swift test --package-path . --filter AnglesiteCoreTests`
Expected: PASS, no regressions in any other suite (`CloudflareOAuthClientTests`, etc. are untouched by this change but share the target).

- [ ] **Step 2: Run the full test suite (all Swift package targets)**

Run: `swift test --package-path .`
Expected: PASS. Note in the PR if `AnglesiteContainerLocalTests`/e2e suites are skipped (they're opt-in per `AGENTS.md`) or if the sibling `anglesite` checkout is absent (MCP e2e tests skip cleanly).

- [ ] **Step 3: Remove the in-progress label and open the PR**

```bash
gh issue edit 936 --remove-label "🛠️ In Progress"
git push -u origin claude/issue-936-ec5056
```

Then open a PR using `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan) per `CONTRIBUTING.md` — **Paired PR check: not applicable**, this is app-only (no MCP schema change; `@dwk/dpop` already supports `expectedNonce`, see the spec's "Cross-repo note").

---

## Self-Review Notes

- **Spec coverage:** §1 `DPoPKeyPair.proof(nonce:)` → Task 1. §2 `DPoPNonceChallenge` → Task 1. §3 `SiteIndieAuthClient.exchange` retry → Task 2. §4 `MicrosubClient` retry → Task 3. Testing section → one test per bullet, spread across Tasks 1-3. "Alternative considered" (nonce caching) is explicitly rejected in the spec — no task needed. "Cross-repo note" is a coordination note, not a code task — called out in Task 4's PR step instead.
- **Placeholder scan:** none found — every step has complete code or an exact command.
- **Type consistency:** `DPoPKeyPair.proof(htm:htu:accessToken:nonce:)` signature is identical across Tasks 1-3. `DPoPNonceChallenge.nonce(in:response:)` signature and name match everywhere it's called (Tasks 2 and 3). `MicrosubClient.authorize(_:method:nonce:)` and `sendAuthorized`/`authorizedSend` names are used consistently within Task 3 (no `sendAuthorised`/other typos).
