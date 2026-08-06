// Tests/AnglesiteCoreTests/WorkersConformanceTests.swift
import Testing
@testable import AnglesiteCore

@Suite("WorkersConformance")
struct WorkersConformanceTests {
    @Test("every phaseRequirements package is classified known-suite or no-known-suite, never both")
    func phaseRequirementsPackagesAreExhaustivelyClassified() {
        let required = Set(WorkersConformanceStatus.phaseRequirements.values.flatMap { $0 })
        let known = Set(WorkersPackageStatus.packagesWithKnownConformanceSuites.keys)
        let noSuite = WorkersPackageStatus.packagesWithNoKnownConformanceSuite

        #expect(known.isDisjoint(with: noSuite))
        #expect(required.isSubset(of: known.union(noSuite)))
    }

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
              "suites": { "indieauth.rocks": { "status": "passing" } },
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

    @Test("empty suites dict counts as passing for a package with no known public suite")
    func emptySuitesArePassing() throws {
        let json = """
        {
          "packages": {
            "@dwk/microsub": {
              "standard": "Microsub",
              "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let microsub = try #require(status.packages["@dwk/microsub"])
        #expect(microsub.areAllSuitesPassing)
        #expect(microsub.isReleaseReady)
    }

    @Test("a known-conformance package with passing integration and no suites is unverified, not release-ready")
    func knownConformancePackageWithNoSuitesIsUnverified() throws {
        let json = """
        {
          "packages": {
            "@dwk/webmention": {
              "standard": "Webmention",
              "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let webmention = try #require(status.packages["@dwk/webmention"])
        #expect(webmention.isIntegrationPassing)
        #expect(webmention.isMissingRequiredSuite)
        #expect(!webmention.areAllSuitesPassing)
        #expect(!webmention.isReleaseReady)
    }

    @Test("indieauth with passing integration and no suites is unverified, not release-ready (V-2 regression)")
    func indieauthWithNoSuitesIsUnverified() throws {
        // Regression for #1275 review feedback: indieauth.rocks is a public conformance suite in
        // the same IndieWeb family as webmention.rocks/micropub.rocks, and V-2's phaseRequirements
        // gates on @dwk/indieauth — an empty `suites` dict here must not vacuously pass, or V-2
        // could unblock on @dwk/webmention evidence alone.
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
        #expect(indieauth.isMissingRequiredSuite)
        #expect(!indieauth.areAllSuitesPassing)
        #expect(!indieauth.isReleaseReady)
    }

    @Test("a package with a real failing suite is blocked, not unverified")
    func knownConformancePackageWithFailingSuiteIsBlockedNotUnverified() throws {
        let json = """
        {
          "packages": {
            "@dwk/micropub": {
              "standard": "Micropub",
              "suites": { "micropub.rocks": { "status": "failing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let micropub = try #require(status.packages["@dwk/micropub"])
        #expect(!micropub.isMissingRequiredSuite)
        #expect(!micropub.areAllSuitesPassing)

        let gate = WorkersConformanceStatus(packages: ["@dwk/micropub": micropub])
            .gateStatus(for: .v3)
        #expect(gate.blocked.contains("@dwk/micropub"))
        #expect(!gate.unverified.contains("@dwk/micropub"))
    }

    @Test("gateStatus reports V-2 unverified (not ready) when webmention has passing integration but no suite evidence")
    func gateStatusUnverifiedWithoutSuiteEvidence() throws {
        let json = """
        {
          "packages": {
            "@dwk/webmention": {
              "standard": "Webmention",
              "suites": {},
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/indieauth": {
              "standard": "IndieAuth",
              "suites": { "indieauth.rocks": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let v2Gate = status.gateStatus(for: .v2)
        #expect(v2Gate.unverified.contains("@dwk/webmention"))
        #expect(v2Gate.ready.contains("@dwk/indieauth"))
        #expect(!v2Gate.ready.contains("@dwk/webmention"))
        #expect(!v2Gate.blocked.contains("@dwk/webmention"))
        #expect(!v2Gate.isUnblocked)
    }

    @Test("gateStatus reports storage blocked when webdav or solid-oidc is pending, unblocked when all three pass")
    func storagePhaseGate() throws {
        let pendingJSON = """
        {
          "packages": {
            "@dwk/webdav": {
              "standard": "WebDAV", "suites": { "litmus": { "status": "failing" } },
              "integration": { "status": "pending", "cases": [] }
            },
            "@dwk/solid-pod": {
              "standard": "Solid Protocol", "suites": { "solid-cth": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/solid-oidc": {
              "standard": "Solid-OIDC", "suites": {},
              "integration": { "status": "pending", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!
        let pendingStatus = try WorkersConformanceReader.parse(pendingJSON)
        let blockedGate = pendingStatus.gateStatus(for: .storage)
        #expect(blockedGate.blocked.contains("@dwk/webdav"))
        #expect(blockedGate.blocked.contains("@dwk/solid-oidc"))
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
              "standard": "Solid Protocol", "suites": { "solid-cth": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/solid-oidc": {
              "standard": "Solid-OIDC", "suites": { "solid-cth": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!
        let passingStatus = try WorkersConformanceReader.parse(passingJSON)
        #expect(passingStatus.gateStatus(for: .storage).isUnblocked)
    }

    @Test("solid-pod with passing integration and no suites is unverified (Solid CTH not wired in yet)")
    func solidPodWithNoSuitesIsUnverified() throws {
        // Regression for #1275 review feedback: an earlier revision classified the Solid family
        // as "no known suite" even though its own doc comment named the Solid Protocol
        // Conformance Test Harness as an existing upstream suite — reopening #957's fail-open
        // hole for @dwk/solid-pod/@dwk/webdav/@dwk/solid-oidc specifically.
        let json = """
        {
          "packages": {
            "@dwk/solid-pod": {
              "standard": "Solid Protocol",
              "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let solidPod = try #require(status.packages["@dwk/solid-pod"])
        #expect(solidPod.isMissingRequiredSuite)
        #expect(!solidPod.areAllSuitesPassing)
        #expect(!solidPod.isReleaseReady)

        let gate = WorkersConformanceStatus(packages: ["@dwk/solid-pod": solidPod]).gateStatus(for: .storage)
        #expect(gate.unverified.contains("@dwk/solid-pod"))
        #expect(!gate.ready.contains("@dwk/solid-pod"))
    }

    @Test("a known-conformance package reporting only an unrelated suite key does not vacuously pass (#1295)")
    func knownConformancePackageWithUnrelatedSuiteKeyDoesNotPass() throws {
        // #1295: areAllSuitesPassing previously only checked that whatever suites *were*
        // reported all said "passing" — a package could report a misnamed or unrelated suite key
        // and satisfy that vacuously, without indieauth.rocks (its actual expected suite) ever
        // having run.
        let json = """
        {
          "packages": {
            "@dwk/indieauth": {
              "standard": "IndieAuth",
              "suites": { "some-unrelated-suite": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let indieauth = try #require(status.packages["@dwk/indieauth"])
        // The real indieauth.rocks suite has reported nothing, same as an empty suites dict —
        // this is missing evidence, not a verified pass.
        #expect(indieauth.isMissingRequiredSuite)
        #expect(!indieauth.areAllSuitesPassing)
        #expect(!indieauth.isReleaseReady)
    }

    @Test("webmention reporting only sender (receiver missing) does not vacuously pass (#1295)")
    func webmentionPartialSuiteReportDoesNotPass() throws {
        // @dwk/webmention expects both webmention.rocks/sender and webmention.rocks/receiver;
        // reporting only one, even as "passing", must not satisfy areAllSuitesPassing.
        let json = """
        {
          "packages": {
            "@dwk/webmention": {
              "standard": "Webmention",
              "suites": { "webmention.rocks/sender": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let webmention = try #require(status.packages["@dwk/webmention"])
        // receiver's evidence is missing (not failing) — same bucket as a fully-empty suites dict.
        #expect(webmention.isMissingRequiredSuite)
        #expect(!webmention.hasFailingReportedSuite)
        #expect(!webmention.areAllSuitesPassing)
        #expect(!webmention.isReleaseReady)
    }

    @Test("gateStatus reports a partial suite report as unverified, not blocked (#1295 review feedback)")
    func gateStatusPartialSuiteReportIsUnverified() throws {
        // Review feedback on #1295: a partial report (sender present, receiver absent) is missing
        // evidence for the receiver suite, same as a fully-empty suites dict — it must land in
        // `unverified`, not fall through to `blocked` just because `suites` is non-empty.
        let json = """
        {
          "packages": {
            "@dwk/webmention": {
              "standard": "Webmention",
              "suites": { "webmention.rocks/sender": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/indieauth": {
              "standard": "IndieAuth",
              "suites": { "indieauth.rocks": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let v2Gate = status.gateStatus(for: .v2)
        #expect(v2Gate.unverified.contains("@dwk/webmention"))
        #expect(!v2Gate.blocked.contains("@dwk/webmention"))
        #expect(!v2Gate.ready.contains("@dwk/webmention"))
    }

    @Test("a real failure alongside a missing suite key still blocks, not unverified (#1295 review feedback)")
    func gateStatusFailingSuiteAlongsideMissingKeyIsBlocked() throws {
        // sender genuinely failed (not just absent) and receiver was never reported — the real
        // failure must take priority over the "missing evidence" classification.
        let json = """
        {
          "packages": {
            "@dwk/webmention": {
              "standard": "Webmention",
              "suites": { "webmention.rocks/sender": { "status": "failing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let webmention = try #require(status.packages["@dwk/webmention"])
        #expect(webmention.isMissingRequiredSuite) // receiver still never reported
        #expect(webmention.hasFailingReportedSuite) // sender genuinely failed
        #expect(!webmention.areAllSuitesPassing)

        let gate = WorkersConformanceStatus(packages: ["@dwk/webmention": webmention]).gateStatus(for: .v2)
        #expect(gate.blocked.contains("@dwk/webmention"))
        #expect(!gate.unverified.contains("@dwk/webmention"))
    }

    @Test("activitypub with an empty expected-key set still passes on any reported passing suite (#1295)")
    func activitypubWithNoSettledKeyStillPassesOnAnyReportedSuite() throws {
        // @dwk/activitypub has no settled status.json key convention yet (empty expected-key
        // set), so it falls back to the pre-#1295 "all reported suites pass" check rather than
        // guessing a key name that could turn a real pass into a permanent false negative.
        let json = """
        {
          "packages": {
            "@dwk/activitypub": {
              "standard": "ActivityPub",
              "suites": { "activitypub-test-suite": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!

        let status = try WorkersConformanceReader.parse(json)
        let activitypub = try #require(status.packages["@dwk/activitypub"])
        #expect(activitypub.areAllSuitesPassing)
        #expect(activitypub.isReleaseReady)
    }
}
