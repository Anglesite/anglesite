import Testing
import Foundation
@testable import AnglesiteCore

struct CloudflareClientTests {
    @Test("CloudflareZoneState is value-equal by field")
    func zoneStateEquatable() {
        let a = CloudflareZoneState(
            dnssecActive: true, sslMode: "strict", alwaysUseHTTPS: true,
            hsts: .init(maxAge: 31_536_000, includeSubdomains: true, preload: false),
            caaRecords: ["0 issue \"letsencrypt.org\""], mxRecords: [],
            spfRecords: ["v=spf1 -all"], dmarcRecords: ["v=DMARC1; p=reject"])
        let b = a
        #expect(a == b)
    }
}

/// A fake transport that routes by URL substring to canned (Data, HTTPURLResponse).
/// Routes are matched longest-needle-first so more specific paths win over prefixes.
func fakeTransport(_ routes: [String: (Int, String)]) -> CloudflareTransport {
    let sorted = routes.sorted { $0.key.count > $1.key.count }
    return { request in
        let url = request.url!.absoluteString
        for (needle, pair) in sorted where url.contains(needle) {
            let resp = HTTPURLResponse(url: request.url!, statusCode: pair.0,
                                       httpVersion: nil, headerFields: nil)!
            return (Data(pair.1.utf8), resp)
        }
        let resp = HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!
        return (Data("{\"success\":false}".utf8), resp)
    }
}

/// Thread-safe spy that records requests for write-method assertions.
final class TransportSpy: @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []

    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return _requests
    }

    func record(_ request: URLRequest) {
        lock.lock()
        defer { lock.unlock() }
        _requests.append(request)
    }
}

/// A method-aware fake transport with optional spy for capturing requests.
/// Routes are matched longest-needle-first so more specific paths win over prefixes.
func spyTransport(_ routes: [String: (Int, String)], spy: TransportSpy? = nil) -> CloudflareTransport {
    let sorted = routes.sorted { $0.key.count > $1.key.count }
    return { request in
        spy?.record(request)
        let url = request.url!.absoluteString
        for (needle, pair) in sorted where url.contains(needle) {
            let resp = HTTPURLResponse(url: request.url!, statusCode: pair.0,
                                       httpVersion: nil, headerFields: nil)!
            return (Data(pair.1.utf8), resp)
        }
        let resp = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        return (Data("{\"success\":true,\"errors\":[],\"result\":{}}".utf8), resp)
    }
}

@Test("resolveZoneID returns the id of the matching active zone")
func resolveZoneIDFound() async throws {
    let json = """
    {"success":true,"errors":[],"messages":[],"result":[{"id":"zone123","name":"example.com","status":"active"}]}
    """
    let client = HTTPCloudflareClient(transport: fakeTransport(["/zones?": (200, json)]))
    let id = try await client.resolveZoneID(domain: "example.com", apiToken: "t")
    #expect(id == "zone123")
}

@Test("resolveZoneID returns nil when no zone matches")
func resolveZoneIDMissing() async throws {
    let json = "{\"success\":true,\"errors\":[],\"messages\":[],\"result\":[]}"
    let client = HTTPCloudflareClient(transport: fakeTransport(["/zones?": (200, json)]))
    let id = try await client.resolveZoneID(domain: "absent.com", apiToken: "t")
    #expect(id == nil)
}

@Test("resolveZoneID matches case-insensitively on the zone name")
func resolveZoneIDCaseInsensitive() async throws {
    let json = """
    {"success":true,"errors":[],"messages":[],"result":[{"id":"zone123","name":"example.com","status":"active"}]}
    """
    let client = HTTPCloudflareClient(transport: fakeTransport(["/zones?": (200, json)]))
    let id = try await client.resolveZoneID(domain: "Example.COM", apiToken: "t")
    #expect(id == "zone123")
}

@Test("a malformed JSON body surfaces as .malformedResponse")
func malformedBodyMaps() async {
    let client = HTTPCloudflareClient(transport: fakeTransport(["/zones?": (200, "not json")]))
    await #expect(throws: CloudflareError.malformedResponse) {
        _ = try await client.resolveZoneID(domain: "example.com", apiToken: "t")
    }
}

@Test("a 403 surfaces as .unauthorized")
func unauthorizedMaps() async {
    let client = HTTPCloudflareClient(transport: fakeTransport(["/zones?": (403, "{\"success\":false}")]))
    await #expect(throws: CloudflareError.unauthorized) {
        _ = try await client.resolveZoneID(domain: "example.com", apiToken: "bad")
    }
}

@Test("workerScriptNames returns every script id across the account's first page")
func workerScriptNamesReturnsIds() async throws {
    let accountsJSON = #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct123"}]}"#
    let scriptsJSON = """
    {"success":true,"errors":[],"messages":[],"result":[{"id":"my-site"},{"id":"other-site"}],
     "result_info":{"page":1,"total_pages":1}}
    """
    let client = HTTPCloudflareClient(transport: fakeTransport([
        "/accounts?per_page=1": (200, accountsJSON),
        "/workers/scripts?per_page=100": (200, scriptsJSON),
    ]))
    let names = try await client.workerScriptNames(apiToken: "t")
    #expect(names == ["my-site", "other-site"])
}

@Test("workerScriptNames pages through more than 100 scripts")
func workerScriptNamesPaginates() async throws {
    let accountsJSON = #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct123"}]}"#
    let page1 = """
    {"success":true,"errors":[],"messages":[],"result":[{"id":"page1-site"}],
     "result_info":{"page":1,"total_pages":2}}
    """
    let page2 = """
    {"success":true,"errors":[],"messages":[],"result":[{"id":"page2-site"}],
     "result_info":{"page":2,"total_pages":2}}
    """
    let client = HTTPCloudflareClient(transport: { request in
        let url = request.url!.absoluteString
        let (status, body): (Int, String)
        if url.contains("/accounts?per_page=1") {
            (status, body) = (200, accountsJSON)
        } else if url.contains("page=2") {
            (status, body) = (200, page2)
        } else if url.contains("/workers/scripts?per_page=100") {
            (status, body) = (200, page1)
        } else {
            (status, body) = (404, "{\"success\":false}")
        }
        let resp = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (Data(body.utf8), resp)
    })
    let names = try await client.workerScriptNames(apiToken: "t")
    #expect(names == ["page1-site", "page2-site"])
}

@Test("workerScriptNames throws when the token has no visible account")
func workerScriptNamesNoAccount() async {
    let emptyAccountsJSON = #"{"success":true,"errors":[],"messages":[],"result":[]}"#
    let client = HTTPCloudflareClient(transport: fakeTransport([
        "/accounts?per_page=1": (200, emptyAccountsJSON),
    ]))
    await #expect(throws: CloudflareError.self) {
        try await client.workerScriptNames(apiToken: "t")
    }
}

@Test("accountID returns the token's first visible account id")
func accountIDReturnsFirstAccount() async throws {
    let accountsJSON = #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct123"}]}"#
    let client = HTTPCloudflareClient(transport: fakeTransport([
        "/accounts?per_page=1": (200, accountsJSON),
    ]))
    let id = try await client.accountID(apiToken: "t")
    #expect(id == "acct123")
}

@Test("accountID throws when the token can see no account")
func accountIDThrowsWithNoAccount() async throws {
    let emptyJSON = #"{"success":true,"errors":[],"messages":[],"result":[]}"#
    let client = HTTPCloudflareClient(transport: fakeTransport([
        "/accounts?per_page=1": (200, emptyJSON),
    ]))
    await #expect(throws: CloudflareError.self) {
        _ = try await client.accountID(apiToken: "t")
    }
}

@Test("zoneState assembles DNSSEC, settings, DNS records, bot mode, and WAF rules")
func zoneStateAssembles() async throws {
    let env = { (r: String) in "{\"success\":true,\"errors\":[],\"messages\":[],\"result\":\(r)}" }
    let routes: [String: (Int, String)] = [
        "/dnssec": (200, env("{\"status\":\"active\"}")),
        "/settings/ssl": (200, env("{\"id\":\"ssl\",\"value\":\"strict\"}")),
        "/settings/always_use_https": (200, env("{\"id\":\"always_use_https\",\"value\":\"on\"}")),
        "/settings/security_header": (200, env("{\"id\":\"security_header\",\"value\":{\"strict_transport_security\":{\"enabled\":true,\"max_age\":31536000,\"include_subdomains\":true,\"preload\":false}}}")),
        "/dns_records": (200, env("[{\"type\":\"CAA\",\"name\":\"example.com\",\"content\":\"0 issue \\\"letsencrypt.org\\\"\"},{\"type\":\"TXT\",\"name\":\"example.com\",\"content\":\"v=spf1 -all\"},{\"type\":\"TXT\",\"name\":\"_dmarc.example.com\",\"content\":\"v=DMARC1; p=reject\"}]")),
        "/settings/bot_management": (200, env("{\"fight_mode\":true}")),
        "/rulesets/rs1": (200, env("{\"id\":\"rs1\",\"phase\":\"http_request_firewall_custom\",\"rules\":[{\"description\":\"Block dotfiles\",\"expression\":\"(x)\",\"action\":\"block\"}]}")),
        "/rulesets": (200, env("[{\"id\":\"rs1\",\"phase\":\"http_request_firewall_custom\"}]")),
    ]
    let client = HTTPCloudflareClient(transport: fakeTransport(routes))
    let s = try await client.zoneState(zoneID: "z", domain: "example.com", apiToken: "t")
    #expect(s.dnssecActive)
    #expect(s.sslMode == "strict")
    #expect(s.alwaysUseHTTPS)
    #expect(s.hsts == CloudflareZoneState.HSTS(maxAge: 31536000, includeSubdomains: true, preload: false))
    #expect(s.caaRecords == ["0 issue \"letsencrypt.org\""])
    #expect(s.spfRecords == ["v=spf1 -all"])
    #expect(s.dmarcRecords == ["v=DMARC1; p=reject"])
    #expect(s.mxRecords.isEmpty)
    #expect(s.botFightMode)
    #expect(s.wafCustomRules.count == 1)
    #expect(s.wafCustomRules.first?.description == "Block dotfiles")
}

@Test("HSTS disabled yields nil hsts; bot fight mode gracefully defaults on error")
func zoneStateHSTSDisabled() async throws {
    let env = { (r: String) in "{\"success\":true,\"errors\":[],\"messages\":[],\"result\":\(r)}" }
    let routes: [String: (Int, String)] = [
        "/dnssec": (200, env("{\"status\":\"disabled\"}")),
        "/settings/ssl": (200, env("{\"id\":\"ssl\",\"value\":\"full\"}")),
        "/settings/always_use_https": (200, env("{\"id\":\"always_use_https\",\"value\":\"off\"}")),
        "/settings/security_header": (200, env("{\"id\":\"security_header\",\"value\":{\"strict_transport_security\":{\"enabled\":false}}}")),
        "/dns_records": (200, env("[]")),
        "/rulesets": (200, env("[]")),
    ]
    let client = HTTPCloudflareClient(transport: fakeTransport(routes))
    let s = try await client.zoneState(zoneID: "z", domain: "example.com", apiToken: "t")
    #expect(!s.dnssecActive)
    #expect(s.hsts == nil)
    #expect(s.caaRecords.isEmpty)
    #expect(!s.botFightMode)
    #expect(s.wafCustomRules.isEmpty)
}

extension CloudflareClientTests {
    private static let baseRoutes: [String: (Int, String)] = [
        "/dnssec": (200, #"{"success":true,"result":{"status":"active"}}"#),
        "/settings/ssl": (200, #"{"success":true,"result":{"value":"strict"}}"#),
        "/settings/always_use_https": (200, #"{"success":true,"result":{"value":"on"}}"#),
        "/settings/security_header": (200, #"{"success":true,"result":{"value":{"strict_transport_security":{"enabled":true,"max_age":31536000,"include_subdomains":true,"preload":false}}}}"#),
        "/dns_records": (200, #"{"success":true,"result":[]}"#),
        "/settings/bot_management": (403, #"{"success":false}"#),
    ]

    @Test("zoneState reads the harden-pack settings when the API grants them")
    func zoneStateHardenPack() async throws {
        var routes = Self.baseRoutes
        routes["/settings/speed_brain"] = (200, #"{"success":true,"result":{"value":"on"}}"#)
        routes["/settings/ech"] = (200, #"{"success":true,"result":{"value":"off"}}"#)
        routes["/zones/z/rulesets/comp1"] = (200, #"{"success":true,"result":{"id":"comp1","phase":"http_response_compression","rules":[{"expression":"true","action":"compress_response","action_parameters":{"algorithms":[{"name":"zstd"},{"name":"gzip"}]}}]}}"#)
        routes["/zones/z/rulesets"] = (200, #"{"success":true,"result":[{"id":"comp1","phase":"http_response_compression"}]}"#)
        routes["/page_shield/scripts"] = (200, #"{"success":true,"result":[{"url":"https://cdn.evil.example/t.js","host":"cdn.evil.example"}]}"#)
        routes["/page_shield"] = (200, #"{"success":true,"result":{"enabled":true}}"#)

        let client = HTTPCloudflareClient(transport: fakeTransport(routes))
        let state = try await client.zoneState(zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(state.speedBrain)
        #expect(!state.ech)
        #expect(state.zstdCompression)
        #expect(state.pageShield == .init(enabled: true, scriptHosts: ["cdn.evil.example"]))
    }

    @Test("zoneState defaults the harden-pack fields when the token can't read them")
    func zoneStateHardenPackDegrades() async throws {
        // No speed_brain/ech/page_shield routes at all -> fakeTransport 404s -> envelope failure.
        var routes = Self.baseRoutes
        routes["/zones/z/rulesets"] = (403, #"{"success":false}"#)
        let client = HTTPCloudflareClient(transport: fakeTransport(routes))
        let state = try await client.zoneState(zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(!state.speedBrain)
        #expect(!state.ech)
        #expect(!state.zstdCompression)
        #expect(state.pageShield == nil)
    }
}

@Test("zoneState follows DNS-record pagination across pages")
func zoneStatePaginates() async throws {
    let plain = { (r: String) in "{\"success\":true,\"errors\":[],\"messages\":[],\"result\":\(r)}" }
    func paged(_ result: String, page: Int, totalPages: Int) -> String {
        "{\"success\":true,\"errors\":[],\"result\":\(result),\"result_info\":{\"page\":\(page),\"total_pages\":\(totalPages)}}"
    }
    let routes: [String: (Int, String)] = [
        "/dnssec": (200, plain("{\"status\":\"active\"}")),
        "/settings/ssl": (200, plain("{\"value\":\"strict\"}")),
        "/settings/always_use_https": (200, plain("{\"value\":\"on\"}")),
        "/settings/security_header": (200, plain("{\"value\":{\"strict_transport_security\":{\"enabled\":false}}}")),
        // "&page=" (not bare "page=") so this can't collide with "per_page=100" in the request URL.
        "&page=1": (200, paged("[{\"type\":\"CAA\",\"name\":\"example.com\",\"content\":\"0 issue \\\"letsencrypt.org\\\"\"}]", page: 1, totalPages: 2)),
        "&page=2": (200, paged("[{\"type\":\"TXT\",\"name\":\"example.com\",\"content\":\"v=spf1 -all\"}]", page: 2, totalPages: 2)),
    ]
    let client = HTTPCloudflareClient(transport: fakeTransport(routes))
    let s = try await client.zoneState(zoneID: "z", domain: "example.com", apiToken: "t")
    #expect(s.caaRecords == ["0 issue \"letsencrypt.org\""]) // page 1
    #expect(s.spfRecords == ["v=spf1 -all"])                 // page 2 — proves pagination
}

@Test("success:false with an error message surfaces as .api")
func apiErrorMaps() async {
    let body = "{\"success\":false,\"errors\":[{\"message\":\"nope\"}],\"result\":null}"
    let client = HTTPCloudflareClient(transport: fakeTransport(["/zones?": (200, body)]))
    await #expect(throws: CloudflareError.api(message: "nope")) {
        _ = try await client.resolveZoneID(domain: "example.com", apiToken: "t")
    }
}

@Test("a 500 surfaces as .http(status:)")
func httpErrorMaps() async {
    let client = HTTPCloudflareClient(transport: fakeTransport(["/zones?": (500, "{}")]))
    await #expect(throws: CloudflareError.http(status: 500)) {
        _ = try await client.resolveZoneID(domain: "example.com", apiToken: "t")
    }
}

@Test("attachWorkersCustomDomain returns .zoneNotFound when the domain has no zone on this account")
func attachCustomDomainZoneNotFound() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[]}"#),
    ]
    let client = HTTPCloudflareClient(transport: fakeTransport(routes))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .zoneNotFound)
}

@Test("attachWorkersCustomDomain creates a fresh attachment when none exists yet")
func attachCustomDomainCreatesFresh() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"zone1","name":"example.com","status":"active"}]}"#),
        "/accounts?per_page=1": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct1"}]}"#),
        "/workers/domains?hostname=": (200, #"{"success":true,"errors":[],"messages":[],"result":[]}"#),
    ]
    let spy = TransportSpy()
    let client = HTTPCloudflareClient(transport: spyTransport(routes, spy: spy))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .attached)
    let putRequest = spy.requests.first { $0.httpMethod == "PUT" }
    #expect(putRequest != nil)
    #expect(putRequest?.url?.absoluteString.contains("/accounts/acct1/workers/domains") == true)
}

@Test("attachWorkersCustomDomain returns .alreadyAttached without writing when this site's own Worker already owns it")
func attachCustomDomainAlreadyAttached() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"zone1","name":"example.com","status":"active"}]}"#),
        "/accounts?per_page=1": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct1"}]}"#),
        "/workers/domains?hostname=": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"dom1","hostname":"example.com","service":"my-site"}]}"#),
    ]
    let spy = TransportSpy()
    let client = HTTPCloudflareClient(transport: spyTransport(routes, spy: spy))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .alreadyAttached)
    #expect(spy.requests.contains { $0.httpMethod == "PUT" } == false)
}

@Test("attachWorkersCustomDomain returns .conflict without writing when a different Worker owns it")
func attachCustomDomainConflict() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"zone1","name":"example.com","status":"active"}]}"#),
        "/accounts?per_page=1": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct1"}]}"#),
        "/workers/domains?hostname=": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"dom1","hostname":"example.com","service":"other-site"}]}"#),
    ]
    let spy = TransportSpy()
    let client = HTTPCloudflareClient(transport: spyTransport(routes, spy: spy))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .conflict(ownedBy: "other-site"))
    #expect(spy.requests.contains { $0.httpMethod == "PUT" } == false)
}
