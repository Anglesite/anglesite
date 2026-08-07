import Testing
import Foundation
@testable import AnglesiteCore

struct AgentReadinessScanningTests {
    private let accountsJSON = """
    {"success":true,"errors":[],"result":[{"id":"acct1"}]}
    """

    @Test("submitAgentReadinessScan posts agentReadiness:true, unlisted visibility, and returns the scan uuid")
    func submitReturnsScanID() async throws {
        let spy = TransportSpy()
        let submissionJSON = """
        {"uuid":"182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e","url":"https://example.com","result":"r","api":"a","visibility":"unlisted","message":"Submission successful"}
        """
        let client = HTTPCloudflareClient(transport: spyTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/urlscanner/v2/scan": (200, submissionJSON),
        ], spy: spy))

        let scanID = try await client.submitAgentReadinessScan(url: URL(string: "https://example.com")!, apiToken: "t")

        #expect(scanID.uuidString.lowercased() == "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e")

        let scanRequest = try #require(spy.requests.first { $0.url?.absoluteString.contains("/urlscanner/v2/scan") == true })
        #expect(scanRequest.httpMethod == "POST")
        #expect(scanRequest.url?.absoluteString.contains("/accounts/acct1/urlscanner/v2/scan") == true)
        let body = try #require(scanRequest.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["url"] as? String == "https://example.com")
        #expect(json["visibility"] as? String == "unlisted")
        #expect((json["options"] as? [String: Any])?["agentReadiness"] as? Bool == true)
    }

    @Test("agentReadinessResult returns nil while the scan is still processing (404)")
    func resultPendingReturnsNil() async throws {
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/urlscanner/v2/result/": (404, "{}"),
        ]))

        let report = try await client.agentReadinessResult(scanID: UUID(), apiToken: "t")
        #expect(report == nil)
    }

    @Test("agentReadinessResult maps checks, statuses, categories, and next-level info")
    func resultDecodesReport() async throws {
        let resultJSON = """
        {
          "meta": {
            "processors": {
              "agentReadiness": {
                "level": 2,
                "levelName": "Bot-Aware",
                "checks": {
                  "discoverability": {
                    "robotsTxt": {"status": "pass"},
                    "sitemap": {"status": "fail"}
                  },
                  "contentAccessibility": {
                    "markdownNegotiation": {"status": "fail"}
                  },
                  "botAccessControl": {
                    "contentSignals": {"status": "pass"}
                  },
                  "discovery": {
                    "mcpServerCard": {"status": "neutral"}
                  }
                },
                "nextLevel": {"name": "Agent-Readable", "target": 3}
              }
            }
          }
        }
        """
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/urlscanner/v2/result/": (200, resultJSON),
        ]))

        let report = try await client.agentReadinessResult(scanID: UUID(), apiToken: "t")
        let unwrapped = try #require(report)

        #expect(unwrapped.level == 2)
        #expect(unwrapped.levelName == "Bot-Aware")
        #expect(unwrapped.nextLevel == AgentReadinessReport.NextLevel(name: "Agent-Readable", target: 3))
        #expect(unwrapped.totalCount == 5)
        #expect(unwrapped.passedCount == 2)

        let discoverability = try #require(unwrapped.categories.first { $0.id == "discoverability" })
        #expect(discoverability.displayName == "Discoverability")
        let robotsTxt = try #require(discoverability.checks.first { $0.id == "robotsTxt" })
        #expect(robotsTxt.status == .pass)
        #expect(robotsTxt.anglesiteProvides == true)
        let sitemap = try #require(discoverability.checks.first { $0.id == "sitemap" })
        #expect(sitemap.status == .fail)
        #expect(sitemap.hint == AgentReadinessCatalog.checkInfo(for: "sitemap").failHint)

        let discovery = try #require(unwrapped.categories.first { $0.id == "discovery" })
        let mcp = try #require(discovery.checks.first { $0.id == "mcpServerCard" })
        #expect(mcp.status == .neutral)
    }

    @Test("agentReadinessResult throws malformedResponse when the finished scan has no agentReadiness section")
    func resultMissingAgentReadinessThrows() async throws {
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/urlscanner/v2/result/": (200, "{\"meta\":{\"processors\":{}}}"),
        ]))

        await #expect(throws: CloudflareError.malformedResponse) {
            _ = try await client.agentReadinessResult(scanID: UUID(), apiToken: "t")
        }
    }

    @Test("agentReadinessResult maps 401 to unauthorized")
    func resultUnauthorized() async throws {
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/urlscanner/v2/result/": (401, "{}"),
        ]))

        await #expect(throws: CloudflareError.unauthorized) {
            _ = try await client.agentReadinessResult(scanID: UUID(), apiToken: "t")
        }
    }
}
