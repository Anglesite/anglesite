import Testing
import Foundation
@testable import AnglesiteCore

struct DomainDNSClientTests {
    private let zoneID = "zone123"
    private let token = "test-token"

    @Test("listDNSRecords decodes id/type/name/content/ttl/proxied")
    func listDecodesFields() async throws {
        let json = """
        {"success":true,"errors":[],"result":[
            {"id":"rec1","type":"TXT","name":"_atproto.example.com","content":"did=did:plc:abc","ttl":1,"proxied":false},
            {"id":"rec2","type":"A","name":"example.com","content":"192.0.2.1","ttl":300,"proxied":true}
        ]}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records?per_page=100": (200, json)]))
        let records = try await client.listDNSRecords(zoneID: zoneID, apiToken: token)
        #expect(records.count == 2)
        #expect(records[0] == DNSRecord(id: "rec1", type: "TXT", name: "_atproto.example.com", content: "did=did:plc:abc", ttl: 1, proxied: false))
        #expect(records[1] == DNSRecord(id: "rec2", type: "A", name: "example.com", content: "192.0.2.1", ttl: 300, proxied: true))
    }

    @Test("listDNSRecords follows pagination across pages")
    func listPaginates() async throws {
        func paged(_ result: String, page: Int, totalPages: Int) -> String {
            "{\"success\":true,\"errors\":[],\"result\":\(result),\"result_info\":{\"page\":\(page),\"total_pages\":\(totalPages)}}"
        }
        let routes: [String: (Int, String)] = [
            // "&page=" (not bare "page=") so this can't collide with "per_page=100" in the request URL.
            "&page=1": (200, paged("[{\"id\":\"rec1\",\"type\":\"TXT\",\"name\":\"a.example.com\",\"content\":\"one\",\"ttl\":1}]", page: 1, totalPages: 2)),
            "&page=2": (200, paged("[{\"id\":\"rec2\",\"type\":\"TXT\",\"name\":\"b.example.com\",\"content\":\"two\",\"ttl\":1}]", page: 2, totalPages: 2)),
        ]
        let client = HTTPCloudflareClient(transport: fakeTransport(routes))
        let records = try await client.listDNSRecords(zoneID: zoneID, apiToken: token)
        #expect(records.map(\.id) == ["rec1", "rec2"])
    }

    @Test("listDNSRecords decodes the comment field")
    func listDecodesComment() async throws {
        let json = """
        {"success":true,"errors":[],"result":[
            {"id":"rec1","type":"MX","name":"example.com","content":"mx01.mail.icloud.com","ttl":1,"proxied":false,"comment":"anglesite:email:icloud"}
        ]}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records?per_page=100": (200, json)]))
        let records = try await client.listDNSRecords(zoneID: zoneID, apiToken: token)
        #expect(records.first?.comment == "anglesite:email:icloud")
    }

    @Test("listDNSRecords defaults comment to nil when absent")
    func listDefaultsCommentToNil() async throws {
        let json = """
        {"success":true,"errors":[],"result":[
            {"id":"rec1","type":"A","name":"example.com","content":"192.0.2.1","ttl":300,"proxied":true}
        ]}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records?per_page=100": (200, json)]))
        let records = try await client.listDNSRecords(zoneID: zoneID, apiToken: token)
        #expect(records.first?.comment == nil)
    }

    @Test("listDNSRecords defaults proxied to false when absent")
    func listDefaultsProxied() async throws {
        let json = """
        {"success":true,"errors":[],"result":[
            {"id":"rec1","type":"MX","name":"example.com","content":"mail.example.com","ttl":3600}
        ]}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records?per_page=100": (200, json)]))
        let records = try await client.listDNSRecords(zoneID: zoneID, apiToken: token)
        #expect(records.first?.proxied == false)
    }

    @Test("listDNSRecords returns an empty array for a zone with no records")
    func listEmpty() async throws {
        let json = #"{"success":true,"errors":[],"result":[]}"#
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records?per_page=100": (200, json)]))
        let records = try await client.listDNSRecords(zoneID: zoneID, apiToken: token)
        #expect(records.isEmpty)
    }

    @Test("listDNSRecords maps a 401 to .unauthorized")
    func listUnauthorized() async {
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records?per_page=100": (401, "{\"success\":false}")]))
        await #expect(throws: CloudflareError.unauthorized) {
            try await client.listDNSRecords(zoneID: zoneID, apiToken: "bad")
        }
    }

    @Test("deleteDNSRecord sends DELETE to /zones/{id}/dns_records/{recordID}")
    func deleteSendsCorrectRequest() async throws {
        let spy = TransportSpy()
        let client = HTTPCloudflareClient(transport: spyTransport([:], spy: spy))
        try await client.deleteDNSRecord(zoneID: zoneID, recordID: "rec1", apiToken: token)
        let req = try #require(spy.requests.first)
        #expect(req.httpMethod == "DELETE")
        #expect(req.url?.path.hasSuffix("/zones/\(zoneID)/dns_records/rec1") == true)
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
    }

    @Test("deleteDNSRecord maps a 404 to .http(status: 404)")
    func deleteNotFound() async {
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records/rec1": (404, "{\"success\":false}")]))
        await #expect(throws: CloudflareError.http(status: 404)) {
            try await client.deleteDNSRecord(zoneID: zoneID, recordID: "rec1", apiToken: token)
        }
    }

    @Test("deleteDNSRecord maps a 403 to .unauthorized")
    func deleteUnauthorized() async {
        let client = HTTPCloudflareClient(transport: fakeTransport(["/dns_records/rec1": (403, "{\"success\":false}")]))
        await #expect(throws: CloudflareError.unauthorized) {
            try await client.deleteDNSRecord(zoneID: zoneID, recordID: "rec1", apiToken: "bad")
        }
    }
}
