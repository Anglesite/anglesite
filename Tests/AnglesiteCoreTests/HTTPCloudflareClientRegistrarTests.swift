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
}
