import Testing
import Foundation
@testable import AnglesiteCore

/// Tests `MicrosubClient` against an injected `Transport` — request shaping (method, DPoP/
/// Authorization headers, JSON body vs. query params) and response decoding, no real networking.
@Suite(.serialized)
struct MicrosubClientTests {
    private let endpoint = URL(string: "https://owner.example/microsub")!

    private func response(_ code: Int, url: URL? = nil) -> HTTPURLResponse {
        HTTPURLResponse(url: url ?? endpoint, statusCode: code, httpVersion: nil, headerFields: nil)!
    }

    #if canImport(CryptoKit)
    @Test("listChannels sends a GET with action=channels and decodes the channel list")
    func listChannelsDecodesResponse() async throws {
        var captured: URLRequest?
        let client = MicrosubClient(
            endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                let body = #"{"channels":[{"uid":"c1","name":"Blogs","unread":3}]}"#
                return (Data(body.utf8), self.response(200))
            }
        )
        let channels = try await client.listChannels()

        #expect(channels == [MicrosubChannel(uid: "c1", name: "Blogs", unread: 3)])
        #expect(captured?.httpMethod == "GET")
        let items = URLComponents(url: captured!.url!, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(items.contains(URLQueryItem(name: "action", value: "channels")))
        #expect(captured?.value(forHTTPHeaderField: "Authorization") == "DPoP tok-123")
        #expect(captured?.value(forHTTPHeaderField: "DPoP")?.split(separator: ".").count == 3)
    }

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

    @Test("follow posts a JSON body with action/channel/url")
    func followPostsJSONBody() async throws {
        var captured: URLRequest?
        let client = MicrosubClient(
            endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data("{}".utf8), self.response(200))
            }
        )
        try await client.follow(url: "https://feed.example/atom.xml", channel: "c1")

        #expect(captured?.httpMethod == "POST")
        #expect(captured?.url == endpoint)
        #expect(captured?.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let body = try JSONSerialization.jsonObject(with: captured!.httpBody!) as! [String: String]
        #expect(body["action"] == "follow")
        #expect(body["channel"] == "c1")
        #expect(body["url"] == "https://feed.example/atom.xml")
    }

    @Test("markRead sends the entry ids as a JSON array")
    func markReadSendsEntryArray() async throws {
        var captured: URLRequest?
        let client = MicrosubClient(
            endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data("{}".utf8), self.response(200))
            }
        )
        try await client.markRead(channel: "c1", entries: ["e1", "e2"])

        let body = try JSONSerialization.jsonObject(with: captured!.httpBody!) as! [String: Any]
        #expect(body["method"] as? String == "mark_read")
        #expect(body["entry"] as? [String] == ["e1", "e2"])
    }

    @Test("timeline decodes items and paging cursors")
    func timelineDecodesPage() async throws {
        let client = MicrosubClient(
            endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in
                let body = """
                {"items":[{"_id":"1","url":"https://feed.example/1","name":"Hello","content":{"text":"hi"}}],"paging":{"after":"cursor-2"}}
                """
                return (Data(body.utf8), self.response(200))
            }
        )
        let page = try await client.timeline(channel: "c1")

        #expect(page.items.count == 1)
        #expect(page.items[0].id == "1")
        #expect(page.items[0].name == "Hello")
        #expect(page.items[0].content?.text == "hi")
        #expect(page.paging.after == "cursor-2")
        #expect(page.paging.before == nil)
    }

    @Test("a non-2xx response throws .requestFailed with the status code")
    func nonSuccessStatusThrows() async {
        let client = MicrosubClient(
            endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in (Data("insufficient_scope".utf8), self.response(403)) }
        )
        await #expect(throws: MicrosubError.requestFailed(status: 403, body: "insufficient_scope")) {
            _ = try await client.listChannels()
        }
    }

    @Test("an undecodable response throws .decodingFailed")
    func undecodableResponseThrows() async {
        let client = MicrosubClient(
            endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in (Data("not json".utf8), self.response(200)) }
        )
        await #expect(throws: MicrosubError.self) {
            _ = try await client.listChannels()
        }
    }
    #endif
}
