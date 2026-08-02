import Testing
import Foundation
@testable import AnglesiteCore

struct HTTPCloudflareClientRegistrarTests {
    private let accountsJSON = #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct123"}]}"#

    @Test("searchDomains returns candidate names")
    func searchReturnsNames() async throws {
        let searchJSON = """
        {"success":true,"errors":[],"messages":[],"result":{"domains":[
            {"name":"example.dev","registrable":true,"tier":"standard","pricing":{"currency":"USD","registration_cost":"10.11","renewal_cost":"10.11"}},
            {"name":"example.app","registrable":true,"tier":"standard","pricing":{"currency":"USD","registration_cost":"11.00","renewal_cost":"11.00"}}
        ]}}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-search": (200, searchJSON),
        ]))
        let names = try await client.searchDomains(query: "example", apiToken: "t")
        #expect(names == ["example.dev", "example.app"])
    }

    @Test("searchDomains correctly percent-encodes & = + in the query value")
    func searchEncodesSpecialCharacters() async throws {
        let searchJSON = """
        {"success":true,"errors":[],"messages":[],"result":{"domains":[]}}
        """
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-search": (200, searchJSON),
        ], spy: spy))
        _ = try await client.searchDomains(query: "Smith & Sons = 1+1", apiToken: "t")

        let sent = try #require(spy.requests.first { $0.url?.path.contains("domain-search") == true })
        let sentURL = try #require(sent.url)
        let components = try #require(URLComponents(url: sentURL, resolvingAgainstBaseURL: false))
        let items = components.queryItems ?? []
        // Both `q` and `limit` must survive intact as separate query items — a naive
        // `.urlQueryAllowed` escape leaves `&`/`=`/`+` unescaped, which splits `q`'s value at
        // the `&` and corrupts/loses the `limit` parameter.
        #expect(items.first(where: { $0.name == "q" })?.value == "Smith & Sons = 1+1")
        #expect(items.first(where: { $0.name == "limit" })?.value == "20")
        #expect(items.count == 2)
    }

    @Test("searchDomains percent-encodes a literal + to %2B on the wire")
    func searchEncodesPlusOnWire() async throws {
        // Regression test for a bug that slipped through `searchEncodesSpecialCharacters` above:
        // `URLComponents(url:)` decodes a literal `+` and `%2B` identically back to `+`, so a
        // round-trip assertion through `URLComponents` can't tell a correctly-escaped `+` from an
        // unescaped one. Assert on the raw wire bytes instead — a literal `+` in a query string is
        // conventionally form-decoded as a space by many server-side parsers, so "C++ Institute"
        // must reach the API with `+` escaped as `%2B`, not as a bare `+`.
        let searchJSON = """
        {"success":true,"errors":[],"messages":[],"result":{"domains":[]}}
        """
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-search": (200, searchJSON),
        ], spy: spy))
        _ = try await client.searchDomains(query: "C++ Institute", apiToken: "t")

        let sent = try #require(spy.requests.first { $0.url?.path.contains("domain-search") == true })
        let sentURL = try #require(sent.url)
        let components = try #require(URLComponents(url: sentURL, resolvingAgainstBaseURL: false))
        let wireQuery = try #require(components.percentEncodedQuery)
        #expect(wireQuery.contains("q=C%2B%2B%20Institute"))
        #expect(!wireQuery.contains("C++"))
    }

    @Test("searchDomains surfaces a CloudflareError")
    func searchSurfacesError() async {
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-search": (403, "{\"success\":false}"),
        ]))
        await #expect(throws: CloudflareError.unauthorized) {
            _ = try await client.searchDomains(query: "example", apiToken: "bad")
        }
    }

    @Test("checkDomainAvailability decodes pricing for a registrable domain")
    func checkRegistrable() async throws {
        let checkJSON = """
        {"success":true,"errors":[],"messages":[],"result":{"domains":[
            {"name":"example.dev","registrable":true,"tier":"standard","pricing":{"currency":"USD","registration_cost":"10.11","renewal_cost":"10.11"}}
        ]}}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-check": (200, checkJSON),
        ]))
        let results = try await client.checkDomainAvailability(domains: ["example.dev"], apiToken: "t")
        #expect(results == [
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil,
                                  registrationCost: "10.11", currency: "USD"),
        ])
    }

    @Test("checkDomainAvailability decodes the reason for an unregistrable domain")
    func checkUnregistrable() async throws {
        let checkJSON = """
        {"success":true,"errors":[],"messages":[],"result":{"domains":[
            {"name":"taken.dev","registrable":false,"reason":"domain_unavailable"}
        ]}}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-check": (200, checkJSON),
        ]))
        let results = try await client.checkDomainAvailability(domains: ["taken.dev"], apiToken: "t")
        #expect(results == [
            RegistrarDomainCheck(name: "taken.dev", registrable: false, reason: "domain_unavailable",
                                  registrationCost: nil, currency: nil),
        ])
    }

    @Test("registerDomain resolves succeeded on an immediate 201")
    func registerImmediateSuccess() async throws {
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"succeeded"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .succeeded)
    }

    @Test("registerDomain maps action_required")
    func registerActionRequired() async throws {
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"action_required"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .actionRequired)
    }

    @Test("registerDomain maps blocked")
    func registerBlocked() async throws {
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"blocked"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .blocked)
    }

    @Test("registerDomain maps a 202 that polls straight to succeeded")
    func registerAsyncThenSucceeds() async throws {
        let acceptedJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"in_progress"}}"#
        let statusJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"succeeded"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (202, acceptedJSON),
            // The poll URL (".../registrar/registrations/example.dev/registration-status")
            // contains both this route's needle and the register route's needle above.
            // `fakeTransport` picks the longest matching needle, so this key must stay longer
            // than "/registrar/registrations" (25 chars) or the poll request would wrongly hit
            // the register route again and this test would falsely pass/fail on stale state.
            "example.dev/registration-status": (200, statusJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .succeeded)
    }

    @Test("registerDomain resolves stillProcessing when polling never leaves in_progress")
    func registerAsyncNeverResolves() async throws {
        let acceptedJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"in_progress"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (202, acceptedJSON),
            // See the comment in `registerAsyncThenSucceeds` above — same collision-avoidance need.
            "example.dev/registration-status": (200, acceptedJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .stillProcessing)
    }

    @Test("registerDomain maps failed on an immediate 201")
    func registerImmediateFailed() async throws {
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"failed"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        guard case .failed(let reason) = outcome else {
            Issue.record("expected .failed, got \(outcome)"); return
        }
        #expect(!reason.isEmpty)
    }

    @Test("registerDomain maps an unrecognized state to stillProcessing on an immediate 201")
    func registerImmediateUnknownStateFallsThroughToStillProcessing() async throws {
        // `Self.outcome(forState:)`'s `default:` branch resolves any state it doesn't recognize
        // (not just `in_progress`) to `.stillProcessing` — this pins that existing behavior
        // without changing it, so a Cloudflare-side state string this client doesn't yet know
        // about degrades to "come back later" instead of throwing.
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"some_future_state"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .stillProcessing)
    }

    @Test("registerDomain surfaces a CloudflareError on a 401")
    func registerSurfacesUnauthorizedError() async {
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (401, "{\"success\":false}"),
        ]))
        await #expect(throws: CloudflareError.unauthorized) {
            _ = try await client.registerDomain(name: "example.dev", apiToken: "bad")
        }
    }

    @Test("registrar calls are scoped to the token's account id")
    func registrarCallsAreAccountScoped() async throws {
        // None of the tests above assert the `/accounts/{id}/` segment is actually present and
        // correct — if `resolveAccountID` were ever dropped, or the account id interpolated
        // wrong, every one of them would still pass while every live call 404'd. Assert directly
        // on the sent request URL for all three registrar operations.
        let searchJSON = #"{"success":true,"errors":[],"messages":[],"result":{"domains":[]}}"#
        let checkJSON = #"{"success":true,"errors":[],"messages":[],"result":{"domains":[]}}"#
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"succeeded"}}"#
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-search": (200, searchJSON),
            "/registrar/domain-check": (200, checkJSON),
            "/registrar/registrations": (201, registerJSON),
        ], spy: spy))

        _ = try await client.searchDomains(query: "example", apiToken: "t")
        _ = try await client.checkDomainAvailability(domains: ["example.dev"], apiToken: "t")
        _ = try await client.registerDomain(name: "example.dev", apiToken: "t")

        let registrarRequests = spy.requests.filter { $0.url?.path.contains("/registrar/") == true }
        #expect(registrarRequests.count == 3)
        for request in registrarRequests {
            let path = try #require(request.url?.path)
            #expect(path.contains("/accounts/acct123/registrar/"))
        }
    }
}
