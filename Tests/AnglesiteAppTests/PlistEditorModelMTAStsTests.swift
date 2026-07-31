import Foundation
import Testing
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel MTA-STS (#851)")
@MainActor
struct PlistEditorModelMTAStsTests {
    actor RecordingDNS: DomainOperationsService {
        var added: [(type: String, name: String, content: String)] = []
        var addedPurposes: [String?] = []
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            added.append((type, name, content))
            addedPurposes.append(purpose)
            return .success(())
        }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .success(()) }
    }
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private func makeModel(config: String? = nil, domainOperations: any DomainOperationsService = DomainOperations()) throws -> PlistEditorModel {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("PlistEditorModelMTAStsTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let plistURL = directory.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let config { try config.write(to: directory.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8) }
        return PlistEditorModel(file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"), websiteTitle: "Test Site", sourceDirectory: directory, domainOperations: domainOperations)
    }

    @Test("loads MTA-STS settings from .site-config")
    func load() async throws {
        let model = try makeModel(config: "MTA_STS_MODE=testing\nMTA_STS_DOMAIN=example.com\nMTA_STS_MX=mx.example.com\nTLS_RPT_RUA=reports@example.com\n")
        await model.load()
        #expect(model.mtaStsSettings == .init(mode: .testing, domain: "example.com", mxHosts: "mx.example.com", reportMailbox: "reports@example.com"))
        #expect(!model.isMtaStsDirty)
    }

    @Test("saves a dirty MTA-STS facet and includes it in aggregate saves")
    func save() async throws {
        let model = try makeModel()
        await model.load()
        model.mtaStsSettings = .init(mode: .testing, domain: "example.com", mxHosts: "mx.example.com", reportMailbox: "reports@example.com")
        #expect(model.isMtaStsDirty)
        #expect(model.hasAnyUnsavedEdits)
        await model.saveAllDirty()
        #expect(!model.isMtaStsDirty)
        let config = try String(contentsOf: model.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(MTAStsPolicyAsset.parseSettings(from: config) == model.mtaStsSettings)
    }

    @Test("publishes the required MTA-STS and optional TLS-RPT TXT records through DomainOperations")
    func publishDNS() async throws {
        let dns = RecordingDNS()
        let model = try makeModel(domainOperations: dns)
        await model.load()
        model.mtaStsSettings = .init(mode: .testing, domain: "example.com", mxHosts: "mx.example.com", reportMailbox: "reports@example.com")
        await model.publishMtaStsDNSRecords()
        let added = await dns.added
        #expect(added.count == 2)
        #expect(added[0].type == "TXT")
        #expect(added[0].name == "_mta-sts.example.com")
        #expect(added[1].type == "TXT")
        #expect(added[1].name == "_smtp._tls.example.com")
        #expect(added[1].content == "v=TLSRPTv1; rua=mailto:reports@example.com")
        #expect(await dns.addedPurposes.allSatisfy { $0 == "email:mta-sts" })
    }
}
