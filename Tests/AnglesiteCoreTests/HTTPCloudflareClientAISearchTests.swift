import Testing
import Foundation
@testable import AnglesiteCore

struct HTTPCloudflareClientAISearchTests {
    @Test("createAISearchInstance resolves the account then POSTs to the namespace instances endpoint")
    func createsInstance() async throws {
        let spy = TransportSpy()
        let accountsJSON = #"{"success":true,"errors":[],"result":[{"id":"acct1"}]}"#
        let createJSON = #"{"success":true,"errors":[],"result":{"id":"inst1","name":"example-com"}}"#
        let client = HTTPCloudflareClient(transport: spyTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/ai-search/namespaces/example-com/instances": (200, createJSON),
        ], spy: spy))

        let instance = try await client.createAISearchInstance(
            domain: "example.com", instanceID: "example-com", apiToken: "test-token")

        #expect(instance.id == "inst1")
        #expect(instance.name == "example-com")
        let postReq = try #require(spy.requests.first { $0.httpMethod == "POST" })
        #expect(postReq.url?.path.contains("/accounts/acct1/ai-search/namespaces/example-com/instances") == true)
        let body = try #require(postReq.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(body["id"] as? String == "example-com")
        #expect(body["type"] as? String == "web-crawler")
    }

    @Test("createAISearchInstance surfaces .unauthorized on a 403")
    func createInstanceUnauthorized() async throws {
        let accountsJSON = #"{"success":true,"errors":[],"result":[{"id":"acct1"}]}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/ai-search/namespaces": (403, #"{"success":false,"errors":[{"message":"missing scope"}]}"#),
        ]))
        await #expect(throws: CloudflareError.unauthorized) {
            try await client.createAISearchInstance(domain: "example.com", instanceID: "example-com", apiToken: "t")
        }
    }
}
