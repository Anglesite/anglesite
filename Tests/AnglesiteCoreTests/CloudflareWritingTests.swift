import Testing
import Foundation
@testable import AnglesiteCore

struct CloudflareWritingTests {
    private let zoneID = "zone123"
    private let token = "test-token"

    @Test("enableDNSSEC sends PUT to /zones/{id}/dnssec")
    func enableDNSSEC() async throws {
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([:], spy: spy))
        try await client.enableDNSSEC(zoneID: zoneID, apiToken: token)
        let req = try #require(spy.requests.first)
        #expect(req.httpMethod == "PUT")
        #expect(req.url?.path.contains("/dnssec") == true)
        let body = try #require(req.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(body["status"] as? String == "active")
    }

    @Test("setAlwaysUseHTTPS sends PUT with correct value")
    func setAlwaysUseHTTPS() async throws {
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([:], spy: spy))
        try await client.setAlwaysUseHTTPS(zoneID: zoneID, enabled: true, apiToken: token)
        let req = try #require(spy.requests.first)
        #expect(req.httpMethod == "PUT" || req.httpMethod == "PATCH")
        #expect(req.url?.path.contains("/settings/always_use_https") == true)
        let body = try #require(req.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(body["value"] as? String == "on")
    }

    @Test("setHSTS sends PUT with nested STS object")
    func setHSTS() async throws {
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([:], spy: spy))
        try await client.setHSTS(zoneID: zoneID, maxAge: 31_536_000,
                                  includeSubdomains: true, preload: false, apiToken: token)
        let req = try #require(spy.requests.first)
        #expect(req.httpMethod == "PUT" || req.httpMethod == "PATCH")
        #expect(req.url?.path.contains("/settings/security_header") == true)
        #expect(req.httpBody != nil)
    }

    @Test("addDNSRecord sends POST with correct type/name/content")
    func addDNSRecord() async throws {
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([:], spy: spy))
        let payload = DNSRecordPayload(type: "TXT", name: "example.com", content: "v=spf1 -all")
        try await client.addDNSRecord(zoneID: zoneID, record: payload, apiToken: token)
        let req = try #require(spy.requests.first)
        #expect(req.httpMethod == "POST")
        #expect(req.url?.path.contains("/dns_records") == true)
        let body = try #require(req.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(body["type"] as? String == "TXT")
        #expect(body["name"] as? String == "example.com")
        #expect(body["content"] as? String == "v=spf1 -all")
    }

    @Test("setBotFightMode sends PATCH to /bot_management with fight_mode")
    func setBotFightMode() async throws {
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([:], spy: spy))
        try await client.setBotFightMode(zoneID: zoneID, enabled: true, apiToken: token)
        let req = try #require(spy.requests.first)
        #expect(req.httpMethod == "PATCH")
        #expect(req.url?.path.contains("/bot_management") == true)
        #expect(req.url?.path.contains("/settings/") == false)
        let body = try #require(req.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(body["fight_mode"] as? Bool == true)
    }

    @Test("createWAFCustomRule sends POST to rulesets endpoint")
    func createWAFCustomRule() async throws {
        let spy = TransportSpy()
        let rulesetJSON = """
        {"success":true,"errors":[],"messages":[],"result":[{"id":"rs1","phase":"http_request_firewall_custom"}]}
        """
        let client = HTTPCloudflareClient(transport: spyTransport(["/rulesets": (200, rulesetJSON)], spy: spy))
        let rule = WAFRulePayload(description: "Block dotfiles", expression: "(x)", action: "block")
        try await client.createWAFCustomRule(zoneID: zoneID, rule: rule, apiToken: token)
        let postReqs = spy.requests.filter { $0.httpMethod == "POST" }
        #expect(!postReqs.isEmpty)
    }

    @Test("createWAFCustomRule encodes action_parameters.products when provided")
    func createWAFCustomRuleWithActionParameters() async throws {
        let spy = TransportSpy()
        let rulesetJSON = """
        {"success":true,"errors":[],"messages":[],"result":[{"id":"rs1","phase":"http_request_firewall_custom"}]}
        """
        let client = HTTPCloudflareClient(transport: spyTransport(["/rulesets": (200, rulesetJSON)], spy: spy))
        let rule = WAFRulePayload(
            description: "Allow AI Search crawler", expression: "(x)", action: "skip",
            actionParameters: .init(products: ["botFight"]))
        try await client.createWAFCustomRule(zoneID: zoneID, rule: rule, apiToken: token)
        let postReqs = spy.requests.filter { $0.httpMethod == "POST" }
        let body = try #require(postReqs.last?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        let actionParams = try #require(body["action_parameters"] as? [String: Any])
        #expect(actionParams["products"] as? [String] == ["botFight"])
    }

    @Test("WAFRulePayload omits action_parameters from encoded JSON when nil")
    func wafRulePayloadOmitsNilActionParameters() throws {
        let rule = WAFRulePayload(description: "Block dotfiles", expression: "(x)", action: "block")
        let data = try JSONEncoder().encode(rule)
        let obj = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(obj["action_parameters"] == nil)
    }

    @Test("write methods include Authorization header")
    func authorizationHeader() async throws {
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([:], spy: spy))
        try await client.enableDNSSEC(zoneID: zoneID, apiToken: token)
        let req = try #require(spy.requests.first)
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
    }

    @Test("a 403 on a write surfaces as .unauthorized")
    func writeUnauthorized() async {
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dnssec": (403, "{\"success\":false}")]))
        await #expect(throws: CloudflareError.unauthorized) {
            try await client.enableDNSSEC(zoneID: zoneID, apiToken: "bad")
        }
    }
}

extension CloudflareWritingTests {
    private func spiedClient(_ routes: [String: (Int, String)]) -> (HTTPCloudflareClient, TransportSpy) {
        let spy = TransportSpy()
        let inner = fakeTransport(routes)
        let client = HTTPCloudflareClient(transport: { request in
            spy.record(request)
            return try await inner(request)
        })
        return (client, spy)
    }

    @Test("setSpeedBrain PATCHes the speed_brain setting")
    func speedBrainWrite() async throws {
        let (client, spy) = spiedClient([
            "/settings/speed_brain": (200, #"{"success":true,"result":{}}"#),
        ])
        try await client.setSpeedBrain(zoneID: "z", enabled: true, apiToken: "t")
        let request = try #require(spy.requests.last)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url!.path.hasSuffix("/zones/z/settings/speed_brain"))
        #expect(String(data: request.httpBody ?? Data(), encoding: .utf8)!.contains(#""value":"on""#))
    }

    @Test("setECH PATCHes the ech setting")
    func echWrite() async throws {
        let (client, spy) = spiedClient([
            "/settings/ech": (200, #"{"success":true,"result":{}}"#),
        ])
        try await client.setECH(zoneID: "z", enabled: true, apiToken: "t")
        let request = try #require(spy.requests.last)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url!.path.hasSuffix("/zones/z/settings/ech"))
    }

    @Test("setPageShield PUTs enabled")
    func pageShieldWrite() async throws {
        let (client, spy) = spiedClient([
            "/page_shield": (200, #"{"success":true,"result":{}}"#),
        ])
        try await client.setPageShield(zoneID: "z", enabled: true, apiToken: "t")
        let request = try #require(spy.requests.last)
        #expect(request.httpMethod == "PUT")
        #expect(String(data: request.httpBody ?? Data(), encoding: .utf8)!.contains(#""enabled":true"#))
    }

    @Test("enableZstandardCompression creates the compression ruleset when absent")
    func zstdCreatesRuleset() async throws {
        let (client, spy) = spiedClient([
            "/zones/z/rulesets": (200, #"{"success":true,"result":[]}"#),
        ])
        try await client.enableZstandardCompression(zoneID: "z", apiToken: "t")
        let post = try #require(spy.requests.last)
        #expect(post.httpMethod == "POST")
        #expect(post.url!.path.hasSuffix("/zones/z/rulesets"))
        let body = String(data: post.httpBody ?? Data(), encoding: .utf8)!
        #expect(body.contains("http_response_compression"))
        #expect(body.contains(#""name":"zstd""#))
    }

    @Test("enableZstandardCompression appends a rule when the ruleset exists")
    func zstdAppendsRule() async throws {
        let (client, spy) = spiedClient([
            "/zones/z/rulesets/comp1/rules": (200, #"{"success":true,"result":{}}"#),
            "/zones/z/rulesets/comp1": (200, #"{"success":true,"result":{"id":"comp1","phase":"http_response_compression","rules":[]}}"#),
            "/zones/z/rulesets": (200, #"{"success":true,"result":[{"id":"comp1","phase":"http_response_compression"}]}"#),
        ])
        try await client.enableZstandardCompression(zoneID: "z", apiToken: "t")
        let post = try #require(spy.requests.last)
        #expect(post.url!.path.hasSuffix("/zones/z/rulesets/comp1/rules"))
    }

    @Test("enableZstandardCompression is a no-op when the ruleset already has a zstd rule")
    func zstdAlreadyPresentSkipsPost() async throws {
        let existingRuleJSON = """
        {"success":true,"result":{"id":"comp1","phase":"http_response_compression","rules":[
            {"description":"existing","expression":"true","action":"compress_response",
             "action_parameters":{"algorithms":[{"name":"zstd"},{"name":"gzip"}]}}
        ]}}
        """
        let (client, spy) = spiedClient([
            "/zones/z/rulesets/comp1": (200, existingRuleJSON),
            "/zones/z/rulesets": (200, #"{"success":true,"result":[{"id":"comp1","phase":"http_response_compression"}]}"#),
        ])
        try await client.enableZstandardCompression(zoneID: "z", apiToken: "t")
        #expect(spy.requests.allSatisfy { $0.httpMethod == "GET" })
        let last = try #require(spy.requests.last)
        #expect(last.url!.path.hasSuffix("/zones/z/rulesets/comp1"))
    }

    @Test("enableOnionRouting PATCHes the opportunistic_onion setting")
    func onionRoutingWrite() async throws {
        let (client, spy) = spiedClient([
            "/settings/opportunistic_onion": (200, #"{"success":true,"result":{}}"#),
        ])
        try await client.enableOnionRouting(zoneID: "z", enabled: true, apiToken: "t")
        let request = try #require(spy.requests.last)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url!.path.hasSuffix("/zones/z/settings/opportunistic_onion"))
        #expect(String(data: request.httpBody ?? Data(), encoding: .utf8)!.contains(#""value":"on""#))
    }
}
