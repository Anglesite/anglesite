import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@MainActor
@Suite struct DomainModelTests {
    private actor RecordingOps: DomainOperationsService {
        var addedPurposes: [String?] = []
        var addedSourceDirectories: [URL?] = []
        var deletedNames: [String?] = []
        var deletedSourceDirectories: [URL?] = []
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            addedPurposes.append(purpose)
            addedSourceDirectories.append(sourceDirectory)
            return .success(())
        }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            deletedNames.append(name)
            deletedSourceDirectories.append(sourceDirectory)
            return .success(())
        }
    }

    @Test func submitAddRecordWithBlueskyContextWritesThroughWithPurpose() async throws {
        let ops = RecordingOps()
        let model = DomainModel(ops: ops)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        model.configure(site: CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp))

        model.domainInput = "example.com"
        model.resolveAndLoad()
        // `while model.isRunning { await Task.yield() }` is this codebase's established pattern
        // for driving a Task-spawning `@Observable` model to completion in tests — see e.g.
        // `Tests/AnglesiteAppTests/OnionRoutingModelTests.swift`. That pattern relies on `isRunning`
        // already being true the instant the sync entry point returns, because those models flip
        // `phase` to a running case *before* spawning the `Task`. `DomainModel.resolveAndLoad()` /
        // `submitAddRecord()` instead flip `phase` from inside the spawned `Task`'s body, so a
        // plain `while` can observe `isRunning == false` before that `Task` has run even once and
        // exit immediately — the actual failure mode hit while writing this test (`addedPurposes`
        // stayed empty because `beginAddRecord`/`submitAddRecord`'s phase guards silently no-op
        // against a still-`.idle` model). `repeat`-`while` guarantees at least one `Task.yield()`
        // before the check, giving the pending `Task` a chance to run.
        repeat { await Task.yield() } while model.isRunning

        model.beginAddRecord(context: .bluesky)
        model.updateDraft(.init(type: "TXT", name: "_atproto", content: "did=abc", ttl: 1, priority: nil, context: .bluesky))
        model.submitAddRecord()
        repeat { await Task.yield() } while model.isRunning

        #expect(await ops.addedPurposes == ["verification:bluesky"])
        #expect(await ops.addedSourceDirectories == [tmp])
    }

    @Test func confirmDeleteWritesThroughWithRecordNameAndSourceDirectory() async throws {
        let ops = RecordingOps()
        let model = DomainModel(ops: ops)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        model.configure(site: CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp))

        model.domainInput = "example.com"
        model.resolveAndLoad()
        // See the comment on `submitAddRecordWithBlueskyContextWritesThroughWithPurpose` above for
        // why `repeat`-`while` (not a plain `while`) is required here.
        repeat { await Task.yield() } while model.isRunning

        // `listRecords` returns `[]` above, so this is a record `beginDelete` never saw in
        // `phase`'s `records` list — but `beginDelete` only requires `.loaded` phase, matching
        // what `DomainModel.runDelete` actually reads (`record.name`/`record.content` off
        // whatever `DNSRecord` the caller passes), which is the fully-qualified form
        // `listRecords` returns in production (see `CloudflareReading.DNSRecord.name`'s doc
        // comment) — the exact shape #1170's name-normalization fix (`DomainOperationsService`'s
        // `relativeName`) has to handle.
        let record = DNSRecord(
            id: "r1", type: "TXT", name: "_atproto.example.com", content: "did=abc", ttl: 1,
            proxied: false)
        model.beginDelete(record)
        model.confirmDelete()
        repeat { await Task.yield() } while model.isRunning

        #expect(await ops.deletedNames == ["_atproto.example.com"])
        #expect(await ops.deletedSourceDirectories == [tmp])
    }

    // MARK: - useAsBlueskyHandle (#1235)

    private static let did = "did:plc:z72i7hdynmk6r22z27h6tvur"

    private func makeConfiguredSite(siteConfig: String) throws -> (site: CurrentSite, url: URL) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        try siteConfig.write(to: tmp.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return (CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp), tmp)
    }

    private func loadDomain(_ model: DomainModel, domain: String) async {
        model.domainInput = domain
        model.resolveAndLoad()
        // See `submitAddRecordWithBlueskyContextWritesThroughWithPurpose`'s comment: `repeat`-`while`,
        // not a plain `while`, since `phase` flips from inside the spawned `Task`.
        repeat { await Task.yield() } while model.isRunning
    }

    @Test func useAsBlueskyHandleFallsBackToTXTWhenNoATprotoDIDConfigured() async throws {
        let (site, tmp) = try makeConfiguredSite(siteConfig: "SITE_URL=https://example.com\n")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let model = DomainModel(ops: RecordingOps())
        model.configure(site: site)
        await loadDomain(model, domain: "example.com")

        model.useAsBlueskyHandle()

        guard case .addingRecord(let draft, _, _) = model.phase else {
            Issue.record("expected .addingRecord, got \(model.phase)")
            return
        }
        #expect(draft.context == .bluesky)
        #expect(model.blueskyHandlePhase == .idle)
    }

    @Test func useAsBlueskyHandleFallsBackToTXTWhenDomainIsNotTheDeployedSite() async throws {
        // ATPROTO_DID is configured, but SITE_URL points at a different host than the domain
        // loaded in this sheet — the well-known file can't possibly be served there.
        let (site, tmp) = try makeConfiguredSite(
            siteConfig: "SITE_URL=https://elsewhere.example\nATPROTO_DID=\(Self.did)\n")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let model = DomainModel(ops: RecordingOps())
        model.configure(site: site)
        await loadDomain(model, domain: "example.com")

        model.useAsBlueskyHandle()

        guard case .addingRecord(let draft, _, _) = model.phase else {
            Issue.record("expected .addingRecord, got \(model.phase)")
            return
        }
        #expect(draft.context == .bluesky)
    }

    @Test func useAsBlueskyHandleVerifiesTheWellKnownEndpointWhenEligible() async throws {
        let (site, tmp) = try makeConfiguredSite(
            siteConfig: "SITE_URL=https://example.com\nATPROTO_DID=\(Self.did)\n")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let model = DomainModel(ops: RecordingOps(), atprotoDIDTransport: { request in
            let http = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(Self.did.utf8), http)
        })
        model.configure(site: site)
        await loadDomain(model, domain: "example.com")

        model.useAsBlueskyHandle()
        repeat { await Task.yield() } while model.isRunning

        #expect(model.blueskyHandlePhase == .verified(domain: "example.com"))
        // The DNS record flow was never touched — no draft, still `.loaded`.
        guard case .loaded = model.phase else {
            Issue.record("expected .loaded, got \(model.phase)")
            return
        }
    }

    @Test func useAsBlueskyHandleReportsFailureOnMismatch() async throws {
        let (site, tmp) = try makeConfiguredSite(
            siteConfig: "SITE_URL=https://example.com\nATPROTO_DID=\(Self.did)\n")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let model = DomainModel(ops: RecordingOps(), atprotoDIDTransport: { request in
            let http = HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!
            return (Data(), http)
        })
        model.configure(site: site)
        await loadDomain(model, domain: "example.com")

        model.useAsBlueskyHandle()
        repeat { await Task.yield() } while model.isRunning

        guard case .failed = model.blueskyHandlePhase else {
            Issue.record("expected .failed, got \(model.blueskyHandlePhase)")
            return
        }
    }
}
