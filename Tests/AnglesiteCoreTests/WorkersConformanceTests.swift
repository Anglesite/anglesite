// Tests/AnglesiteCoreTests/WorkersConformanceTests.swift
import Testing
@testable import AnglesiteCore

@Suite("WorkersConformance")
struct WorkersConformanceTests {
    @Test("parses a minimal status.json with one passing and one pending package")
    func parsesMinimalStatus() throws {
        let json = """
        {
          "packages": {
            "@dwk/webmention": {
              "standard": "Webmention",
              "suites": {
                "webmention.rocks/sender": { "status": "passing" },
                "webmention.rocks/receiver": { "status": "pending" }
              },
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/micropub": {
              "standard": "Micropub",
              "suites": {
                "micropub.rocks": { "status": "pending" }
              },
              "integration": { "status": "pending", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        #expect(status.packages.count == 2)

        let webmention = try #require(status.packages["@dwk/webmention"])
        #expect(webmention.standard == "Webmention")
        #expect(webmention.isIntegrationPassing)
        #expect(!webmention.areAllSuitesPassing)

        let micropub = try #require(status.packages["@dwk/micropub"])
        #expect(!micropub.isIntegrationPassing)
        #expect(!micropub.areAllSuitesPassing)
    }

    @Test("gateStatus reports V-2 ready when webmention + indieauth pass, V-3 blocked when micropub pending")
    func gateStatus() throws {
        let json = """
        {
          "packages": {
            "@dwk/webmention": {
              "standard": "Webmention",
              "suites": {
                "webmention.rocks/sender": { "status": "passing" },
                "webmention.rocks/receiver": { "status": "passing" }
              },
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/indieauth": {
              "standard": "IndieAuth",
              "suites": {},
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/micropub": {
              "standard": "Micropub",
              "suites": { "micropub.rocks": { "status": "pending" } },
              "integration": { "status": "pending", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)

        let v2Gate = status.gateStatus(for: .v2)
        #expect(v2Gate.ready.contains("@dwk/webmention"))
        #expect(v2Gate.ready.contains("@dwk/indieauth"))
        #expect(v2Gate.isUnblocked)

        let v3Gate = status.gateStatus(for: .v3)
        #expect(v3Gate.ready.contains("@dwk/webmention"))
        #expect(v3Gate.blocked.contains("@dwk/micropub"))
        #expect(v3Gate.blocked.contains("@dwk/websub"))
        #expect(!v3Gate.isUnblocked)
    }

    @Test("empty suites dict counts as passing (no external suite to run)")
    func emptySuitesArePassing() throws {
        let json = """
        {
          "packages": {
            "@dwk/indieauth": {
              "standard": "IndieAuth",
              "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let indieauth = try #require(status.packages["@dwk/indieauth"])
        #expect(indieauth.areAllSuitesPassing)
        #expect(indieauth.isReleaseReady)
    }

    @Test("gateStatus reports storage blocked when webdav is pending, unblocked when both pass")
    func storagePhaseGate() throws {
        let pendingJSON = """
        {
          "packages": {
            "@dwk/webdav": {
              "standard": "WebDAV", "suites": { "litmus": { "status": "failing" } },
              "integration": { "status": "pending", "cases": [] }
            },
            "@dwk/solid-pod": {
              "standard": "Solid Protocol", "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!
        let pendingStatus = try WorkersConformanceReader.parse(pendingJSON)
        let blockedGate = pendingStatus.gateStatus(for: .storage)
        #expect(blockedGate.blocked.contains("@dwk/webdav"))
        #expect(blockedGate.ready.contains("@dwk/solid-pod"))
        #expect(!blockedGate.isUnblocked)

        let passingJSON = """
        {
          "packages": {
            "@dwk/webdav": {
              "standard": "WebDAV", "suites": { "litmus": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/solid-pod": {
              "standard": "Solid Protocol", "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!
        let passingStatus = try WorkersConformanceReader.parse(passingJSON)
        #expect(passingStatus.gateStatus(for: .storage).isUnblocked)
    }
}
