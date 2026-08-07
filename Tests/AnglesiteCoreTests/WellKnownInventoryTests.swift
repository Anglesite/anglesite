import Testing
import Foundation
@testable import AnglesiteCore

@Suite("WellKnownInventory")
struct WellKnownInventoryTests {

    // MARK: Filesystem scan

    @Test("absent .well-known directory scans to no rows, no findings")
    func absentDirectoryScansEmpty() throws {
        let root = try makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let (rows, findings) = WellKnownInventory.scanUserStatic(wellKnownDirectory: root.appendingPathComponent(".well-known"))
        #expect(rows.isEmpty)
        #expect(findings.isEmpty)
    }

    @Test("unknown file scans as user-static with no conformance claim")
    func unknownFileScansAsUserStatic() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        try "hello".write(to: wellKnown.appendingPathComponent("apple-app-site-association"), atomically: true, encoding: .utf8)

        let (rows, findings) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(findings.isEmpty)
        #expect(rows.count == 1)
        #expect(rows[0].suffix == "apple-app-site-association")
        #expect(rows[0].delivery == .userStatic)
        #expect(rows[0].validatorID == nil)
        #expect(rows[0].owner == "user-static")
    }

    @Test("nested directories are preserved with their relative suffix")
    func nestedDirectoriesPreserveSuffix() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        let nested = wellKnown.appendingPathComponent("acme-challenge")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try "token".write(to: nested.appendingPathComponent("abc123"), atomically: true, encoding: .utf8)

        let (rows, findings) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(findings.isEmpty)
        #expect(rows.map(\.suffix) == ["acme-challenge/abc123"])
    }

    @Test("a file whose content carries the security.txt marker is classified generated")
    func securityTxtMarkerClassifiesAsGenerated() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        let content = GeneratedEndpoints.securityTxtMarker + "\nContact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00Z\n"
        try content.write(to: wellKnown.appendingPathComponent("security.txt"), atomically: true, encoding: .utf8)

        let (rows, _) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.count == 1)
        #expect(rows[0].delivery == .generated)
        #expect(rows[0].owner == "generator:security-txt")
        #expect(rows[0].validatorID == "rfc9116")
    }

    @Test("a file whose content carries the mta-sts marker is classified generated")
    func mtaStsMarkerClassifiesAsGenerated() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        let content = "version: STSv1\nmode: testing\nmx: mail.example.com\nmax_age: 604800\n\(GeneratedEndpoints.mtaStsMarker)\n"
        try content.write(to: wellKnown.appendingPathComponent("mta-sts.txt"), atomically: true, encoding: .utf8)

        let (rows, _) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.count == 1)
        #expect(rows[0].delivery == .generated)
        #expect(rows[0].owner == "generator:mta-sts")
        #expect(rows[0].validatorID == "rfc8461")
    }

    @Test("a file whose content matches the site.standard.publication at-URI shape is classified generated")
    func standardSitePublicationShapeClassifiesAsGenerated() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        let content = "at://did:plc:owner/site.standard.publication/anglesite-abc123\n"
        try content.write(to: wellKnown.appendingPathComponent("site.standard.publication"), atomically: true, encoding: .utf8)

        let (rows, _) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.count == 1)
        #expect(rows[0].delivery == .generated)
        #expect(rows[0].owner == "generator:standard-site-publication")
        #expect(rows[0].validatorID == nil)
        #expect(rows[0].registration == .custom("community"))
    }

    @Test("hand-authored content at site.standard.publication that doesn't match the at-URI shape is user-static")
    func standardSitePublicationNonMatchingShapeStaysUserStatic() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        try "not an at-URI".write(
            to: wellKnown.appendingPathComponent("site.standard.publication"), atomically: true, encoding: .utf8)

        let (rows, _) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.count == 1)
        #expect(rows[0].delivery == .userStatic)
    }

    @Test("a document at-URI at the publication suffix is not misclassified as the publication's own output")
    func documentURIShapeIsNotPublicationShape() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        // Wrong collection segment — must not match the publication shape.
        try "at://did:plc:owner/site.standard.document/anglesite-abc123\n".write(
            to: wellKnown.appendingPathComponent("site.standard.publication"), atomically: true, encoding: .utf8)

        let (rows, _) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.count == 1)
        #expect(rows[0].delivery == .userStatic)
    }

    @Test("a generated site.standard.publication colliding with a dynamic claim at the same path names both owners")
    func standardSitePublicationCollidesWithDynamicClaim() throws {
        let generated = [row("site.standard.publication", delivery: .generated, owner: "generator:standard-site-publication")]
        let dynamic = [row("site.standard.publication", delivery: .dynamic, owner: "some-worker-feature")]
        #expect(throws: WellKnownInventory.CollisionError.self) {
            _ = try WellKnownInventory.merge(generated: generated, dynamic: dynamic)
        }
    }

    @Test("a hand-authored file that merely mentions the marker text mid-body is not misclassified")
    func markerMustBeOnRecognizedLine() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        // Marker text appears, but not as security.txt's first line — must not be classified generated.
        let content = "hand-authored file\n" + GeneratedEndpoints.securityTxtMarker + "\n"
        try content.write(to: wellKnown.appendingPathComponent("security.txt"), atomically: true, encoding: .utf8)

        let (rows, _) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.count == 1)
        #expect(rows[0].delivery == .userStatic)
    }

    @Test("a symlink is excluded from inventory with a finding")
    func symlinkIsRejected() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        let outside = wellKnown.deletingLastPathComponent().appendingPathComponent("secret")
        try "shh".write(to: outside, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(
            at: wellKnown.appendingPathComponent("linked"), withDestinationURL: outside)

        let (rows, findings) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.isEmpty)
        #expect(findings.count == 1)
        #expect(findings[0].message.contains("symlink"))
    }

    @Test("a percent-encoded-looking filename is excluded from inventory with a finding")
    func percentEncodedNameIsRejected() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        try "x".write(to: wellKnown.appendingPathComponent("foo%2E%2Ebar"), atomically: true, encoding: .utf8)

        let (rows, findings) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown)
        #expect(rows.isEmpty)
        #expect(findings.count == 1)
        #expect(findings[0].message.contains("percent-encoded"))
    }

    @Test("an oversized file is excluded from inventory with a finding")
    func oversizedFileIsRejected() throws {
        let wellKnown = try makeWellKnownDirectory()
        defer { try? FileManager.default.removeItem(at: wellKnown.deletingLastPathComponent()) }
        try "0123456789".write(to: wellKnown.appendingPathComponent("big.txt"), atomically: true, encoding: .utf8)

        let (rows, findings) = WellKnownInventory.scanUserStatic(wellKnownDirectory: wellKnown, maxFileSizeBytes: 4)
        #expect(rows.isEmpty)
        #expect(findings.count == 1)
        #expect(findings[0].message.contains("exceeds"))
    }

    // MARK: Dynamic and runtime conversion

    @Test("dynamicRows converts an owned well-known claim and drops one outside .well-known")
    func dynamicRowsConverts() throws {
        let webfinger = WorkerRouteClaim(
            path: "/.well-known/webfinger", match: .exact, methods: ["GET", "HEAD"], handler: "webfinger",
            validatorID: "rfc7033", authorityBinding: true,
            specificationURL: URL(string: "https://www.rfc-editor.org/rfc/rfc7033"))
        let notWellKnown = WorkerRouteClaim(path: "/inbox", match: .exact, methods: ["POST"], handler: "inbox")
        let claims = [
            WorkerRouteClaims.OwnedClaim(owner: "webfinger", claim: webfinger),
            WorkerRouteClaims.OwnedClaim(owner: "inbox-capture", claim: notWellKnown),
        ]
        let rows = WellKnownInventory.dynamicRows(from: claims)
        #expect(rows.count == 1)
        #expect(rows[0].suffix == "webfinger")
        #expect(rows[0].owner == "webfinger")
        #expect(rows[0].delivery == .dynamic)
        #expect(rows[0].authorityBinding == true)
        #expect(rows[0].validatorID == "rfc7033")
    }

    @Test("runtimeRows converts RuntimeOwnedPathClaim, preserving prefix match")
    func runtimeRowsConverts() throws {
        let claim = RuntimeOwnedPathClaim(
            id: "acme-managed-tls", owner: "cloudflare-managed-tls", path: "acme-challenge/", match: .prefix,
            schemes: [.http], port: 80, capability: "RFC 8555 managed-TLS ownership")
        let rows = WellKnownInventory.runtimeRows(from: [claim])
        #expect(rows.count == 1)
        #expect(rows[0].suffix == "acme-challenge/")
        #expect(rows[0].match == .prefix)
        #expect(rows[0].delivery == .externalRuntime)
        #expect(rows[0].owner == "cloudflare-managed-tls")
    }

    // MARK: Merge / collision enforcement

    @Test("disjoint rows from every delivery class merge without error, sorted by suffix")
    func disjointRowsMergeCleanly() throws {
        let userStatic = [row("apple-app-site-association", delivery: .userStatic, owner: "user-static")]
        let generated = [row("security.txt", delivery: .generated, owner: "generator:security-txt")]
        let dynamic = [row("webfinger", delivery: .dynamic, owner: "webfinger")]
        let runtime = [row("acme-challenge/", delivery: .externalRuntime, owner: "cloudflare-managed-tls", match: .prefix)]

        let merged = try WellKnownInventory.merge(userStatic: userStatic, generated: generated, dynamic: dynamic, runtime: runtime)
        #expect(merged.map(\.suffix) == ["acme-challenge/", "apple-app-site-association", "security.txt", "webfinger"])
    }

    @Test("two exact claims for the same path is a duplicateClaim error")
    func exactExactCollision() throws {
        let userStatic = [row("webfinger", delivery: .userStatic, owner: "user-static")]
        let dynamic = [row("webfinger", delivery: .dynamic, owner: "webfinger")]
        #expect(throws: WellKnownInventory.CollisionError.self) {
            try WellKnownInventory.merge(userStatic: userStatic, dynamic: dynamic)
        }
    }

    @Test("static vs generated at the same path collides and names both owners")
    func staticGeneratedCollision() throws {
        let userStatic = [row("security.txt", delivery: .userStatic, owner: "user-static")]
        let generated = [row("security.txt", delivery: .generated, owner: "generator:security-txt")]
        do {
            _ = try WellKnownInventory.merge(userStatic: userStatic, generated: generated)
            Issue.record("expected a collision error")
        } catch WellKnownInventory.CollisionError.duplicateClaim(let path, let claimants) {
            #expect(path == "security.txt")
            #expect(Set(claimants.map(\.owner)) == ["user-static", "generator:security-txt"])
        }
    }

    @Test("static vs dynamic at the same path collides")
    func staticDynamicCollision() throws {
        let userStatic = [row("webfinger", delivery: .userStatic, owner: "user-static")]
        let dynamic = [row("webfinger", delivery: .dynamic, owner: "webfinger")]
        #expect(throws: WellKnownInventory.CollisionError.self) {
            try WellKnownInventory.merge(userStatic: userStatic, dynamic: dynamic)
        }
    }

    @Test("an active runtime reservation collides with a static claim at the same path")
    func activeRuntimeCollision() throws {
        let userStatic = [row("acme-challenge/mine", delivery: .userStatic, owner: "user-static")]
        let runtime = [row("acme-challenge/mine", delivery: .externalRuntime, owner: "cloudflare-managed-tls")]
        #expect(throws: WellKnownInventory.CollisionError.self) {
            try WellKnownInventory.merge(userStatic: userStatic, runtime: runtime)
        }
    }

    @Test("no runtime reservation means an exact path under a runtime's usual prefix is untouched")
    func noRuntimeClaimMeansNoReservation() throws {
        let userStatic = [row("acme-challenge/mine", delivery: .userStatic, owner: "user-static")]
        let merged = try WellKnownInventory.merge(userStatic: userStatic, runtime: [])
        #expect(merged.map(\.suffix) == ["acme-challenge/mine"])
    }

    @Test("an exact claim inside another owner's prefix is an overlappingClaims error")
    func exactInsidePrefixCollision() throws {
        let runtime = [row("acme-challenge/", delivery: .externalRuntime, owner: "cloudflare-managed-tls", match: .prefix)]
        let userStatic = [row("acme-challenge/token123", delivery: .userStatic, owner: "user-static")]
        do {
            _ = try WellKnownInventory.merge(userStatic: userStatic, runtime: runtime)
            Issue.record("expected an overlap error")
        } catch WellKnownInventory.CollisionError.overlappingClaims(let path, let claimant, let otherPath, let other) {
            #expect(path == "acme-challenge/token123")
            #expect(claimant.owner == "user-static")
            #expect(otherPath == "acme-challenge/")
            #expect(other.owner == "cloudflare-managed-tls")
        }
    }

    @Test("two overlapping prefix claims from different owners collide")
    func prefixPrefixCollision() throws {
        let dynamic = [row("oauth/", delivery: .dynamic, owner: "indieauth", match: .prefix)]
        let runtime = [row("oauth/callback", delivery: .externalRuntime, owner: "some-runtime", match: .prefix)]
        #expect(throws: WellKnownInventory.CollisionError.self) {
            try WellKnownInventory.merge(dynamic: dynamic, runtime: runtime)
        }
    }

    @Test("an exact claim inside the SAME owner's own prefix claim is self-delegation, not a collision")
    func exactInsideOwnPrefixIsSelfDelegation() throws {
        let runtime = [
            row("acme-challenge/", delivery: .externalRuntime, owner: "cloudflare-managed-tls", match: .prefix),
            row("acme-challenge/http-01", delivery: .externalRuntime, owner: "cloudflare-managed-tls"),
        ]
        let merged = try WellKnownInventory.merge(runtime: runtime)
        #expect(merged.map(\.suffix) == ["acme-challenge/", "acme-challenge/http-01"])
    }

    @Test("two overlapping prefix claims from the SAME owner are self-delegation, not a collision")
    func prefixPrefixSameOwnerIsSelfDelegation() throws {
        let dynamic = [
            row("oauth/", delivery: .dynamic, owner: "indieauth", match: .prefix),
            row("oauth/callback", delivery: .dynamic, owner: "indieauth", match: .prefix),
        ]
        let merged = try WellKnownInventory.merge(dynamic: dynamic)
        #expect(merged.map(\.suffix) == ["oauth/", "oauth/callback"])
    }

    // MARK: #748 build-seam derivation and verification

    @Test("claimManifest derives one entry per row, preserving path/match/owner")
    func claimManifestDerivesEntries() throws {
        let rows = [
            row("security.txt", delivery: .generated, owner: "generator:security-txt"),
            row("acme-challenge/", delivery: .externalRuntime, owner: "cloudflare-managed-tls", match: .prefix),
        ]
        let manifest = WellKnownInventory.claimManifest(from: rows)
        #expect(manifest.entries.count == 2)
        #expect(manifest.entries.contains { $0.path == "security.txt" && $0.owner == "generator:security-txt" && $0.match == .exact })
        #expect(manifest.entries.contains { $0.path == "acme-challenge/" && $0.owner == "cloudflare-managed-tls" && $0.match == .prefix })
    }

    /// The build step needs the delivery class to tell a static file that merely *is* a user-static
    /// claim from one that shadows a dynamic/runtime claim — the collision it must reject.
    @Test("claimManifest carries each row's delivery class")
    func claimManifestCarriesDelivery() throws {
        let rows = [
            row("humans.txt", delivery: .userStatic, owner: "user-static"),
            row("security.txt", delivery: .generated, owner: "generator:security-txt"),
            row("webfinger", delivery: .dynamic, owner: "webfinger"),
            row("acme-challenge/", delivery: .externalRuntime, owner: "cloudflare-managed-tls", match: .prefix),
        ]
        let manifest = WellKnownInventory.claimManifest(from: rows)
        #expect(manifest.entries.map(\.delivery) == ["userStatic", "generated", "dynamic", "externalRuntime"])
    }

    @Test("a manifest entry with no delivery decodes as the non-blocking class")
    func manifestEntryDeliveryDefaults() throws {
        let json = #"{"entries":[{"id":"a","path":"a","match":"exact","owner":"o"}]}"#
        let manifest = try JSONDecoder().decode(WellKnownClaimManifest.self, from: Data(json.utf8))
        #expect(manifest.entries.first?.delivery == "userStatic")
    }

    @Test("verifyBuildArtifacts reports a missing expected static/generated artifact")
    func verifyReportsMissingArtifact() throws {
        let expected = [row("security.txt", delivery: .generated, owner: "generator:security-txt")]
        let result = WellKnownBuildSeamResult(observedArtifacts: [], findings: [])
        let findings = WellKnownInventory.verifyBuildArtifacts(expected: expected, result: result)
        #expect(findings.count == 1)
        #expect(findings[0].path == "security.txt")
        #expect(findings[0].message.contains("was not found"))
    }

    @Test("verifyBuildArtifacts reports an unexpected artifact with no matching claim")
    func verifyReportsUnexpectedArtifact() throws {
        let result = WellKnownBuildSeamResult(observedArtifacts: ["mystery.txt"], findings: [])
        let findings = WellKnownInventory.verifyBuildArtifacts(expected: [], result: result)
        #expect(findings.count == 1)
        #expect(findings[0].path == "mystery.txt")
        #expect(findings[0].message.contains("no matching inventory claim"))
    }

    /// Anglesite's generators run inside the runtime clone at prebuild, so a first deploy's
    /// `security.txt` cannot appear in the host-assembled inventory. Without this, every such
    /// deploy would warn about its own generated output.
    @Test("verifyBuildArtifacts accepts an artifact the build reported as its own generator output")
    func verifyAcceptsBuildGeneratedArtifact() throws {
        let result = WellKnownBuildSeamResult(
            observedArtifacts: ["security.txt", "mystery.txt"], generatedArtifacts: ["security.txt"])
        let findings = WellKnownInventory.verifyBuildArtifacts(expected: [], result: result)
        #expect(findings.map(\.path) == ["mystery.txt"])
    }

    @Test("verifyBuildArtifacts passes clean when every expected static/generated row was observed")
    func verifyPassesWhenArtifactsMatch() throws {
        let expected = [
            row("security.txt", delivery: .generated, owner: "generator:security-txt"),
            row("webfinger", delivery: .dynamic, owner: "webfinger"),
        ]
        // Dynamic rows never produce a dist/ artifact, so only security.txt is expected on disk.
        let result = WellKnownBuildSeamResult(observedArtifacts: ["security.txt"], findings: [])
        let findings = WellKnownInventory.verifyBuildArtifacts(expected: expected, result: result)
        #expect(findings.isEmpty)
    }

    @Test("verifyBuildArtifacts folds in the build step's own findings")
    func verifyFoldsInSeamFindings() throws {
        let result = WellKnownBuildSeamResult(observedArtifacts: [], findings: [.init(path: "mta-sts.txt", message: "stale marker")])
        let findings = WellKnownInventory.verifyBuildArtifacts(expected: [], result: result)
        #expect(findings == [.init(path: "mta-sts.txt", message: "stale marker")])
    }

    // MARK: WellKnownEndpointDescriptor.Registration Codable

    @Test("Registration round-trips known and custom cases through JSON")
    func registrationRoundTrips() throws {
        for registration in [WellKnownEndpointDescriptor.Registration.permanent, .provisional, .deprecated, .custom("worker-declared")] {
            let descriptor = row("x", delivery: .userStatic, owner: "user-static")
            var mutable = descriptor
            mutable.registration = registration
            let data = try JSONEncoder().encode(mutable)
            let decoded = try JSONDecoder().decode(WellKnownEndpointDescriptor.self, from: data)
            #expect(decoded.registration == registration)
        }
    }

    // MARK: Marker drift guard

    /// Reads the REAL `edge-artifacts.ts` template source and asserts Swift's duplicated marker
    /// literals (`GeneratedEndpoints.securityTxtMarker`/`mtaStsMarker`) still appear verbatim —
    /// catching the two drifting apart the way #742's fixture test guards the scan envelope.
    @Test("GeneratedEndpoints markers match the real edge-artifacts.ts source")
    func markersMatchTemplateSource() throws {
        // Tests/AnglesiteCoreTests/WellKnownInventoryTests.swift -> repo root -> Resources/Template/scripts
        let scriptURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources/Template/scripts/edge-artifacts.ts", isDirectory: false)
        let source = try String(contentsOf: scriptURL, encoding: .utf8)
        #expect(source.contains(GeneratedEndpoints.securityTxtMarker))
        #expect(source.contains(GeneratedEndpoints.mtaStsMarker))
    }

    /// Same drift guard for the shape-based `site.standard.publication` check: Swift's
    /// `isStandardSitePublicationURI` and TypeScript's `STANDARD_SITE_PUBLICATION_URI_PATTERN`
    /// (`standard-site.ts`) must keep recognizing the same collection segment.
    @Test("GeneratedEndpoints' standard.site shape check matches the real standard-site.ts source")
    func standardSiteShapeMatchesTemplateSource() throws {
        let scriptURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources/Template/scripts/standard-site.ts", isDirectory: false)
        let source = try String(contentsOf: scriptURL, encoding: .utf8)
        #expect(source.contains("site.standard.publication"))
        #expect(source.contains("STANDARD_SITE_PUBLICATION_URI_PATTERN"))
    }

    /// The build seam is a *string* contract across two languages: rename an env var on either side
    /// and the runtime silently stops receiving the manifest — a security gate that fails open.
    /// This asserts the real `well-known.ts` still names both variables, and that the template's
    /// build lifecycle actually invokes both of its modes.
    @Test("the template build seam still uses the env var names Swift sends")
    func buildSeamContractMatchesTemplateSource() throws {
        let templateRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources/Template", isDirectory: true)
        let script = try String(
            contentsOf: templateRoot.appendingPathComponent("scripts/well-known.ts"), encoding: .utf8)
        #expect(script.contains(WellKnownClaimManifest.environmentVariableName))
        #expect(script.contains(WellKnownClaimManifest.resultPathEnvironmentVariable))
        // The runtime shell emits the result marker itself, exactly once; the script must not.
        #expect(!script.contains(ContainerDeployExecutor.wellKnownResultMarker))

        let packageJSON = try String(
            contentsOf: templateRoot.appendingPathComponent("package.json"), encoding: .utf8)
        #expect(packageJSON.contains("well-known.ts check"))
        #expect(packageJSON.contains("well-known.ts verify"))
    }

    // MARK: Test helpers

    private func row(
        _ suffix: String,
        delivery: WellKnownEndpointDescriptor.Delivery,
        owner: String,
        match: WellKnownPathMatch = .exact
    ) -> WellKnownEndpointDescriptor {
        WellKnownEndpointDescriptor(
            id: "\(owner):\(suffix)", suffix: suffix, match: match, delivery: delivery,
            owner: owner, registration: .custom("test"))
    }

    private func makeTempDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func makeWellKnownDirectory() throws -> URL {
        let root = try makeTempDirectory()
        let wellKnown = root.appendingPathComponent(".well-known")
        try FileManager.default.createDirectory(at: wellKnown, withIntermediateDirectories: true)
        return wellKnown
    }
}
