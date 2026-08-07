import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@MainActor
@Suite struct EmailSetupModelTests {
    private actor FakeOps: DomainOperationsService {
        var existingRecords: [DNSRecord]
        var addedTypes: [String] = []
        var addedPurposes: [String?] = []

        init(existingRecords: [DNSRecord] = []) {
            self.existingRecords = existingRecords
        }

        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> {
            .success(existingRecords)
        }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            addedTypes.append(type)
            addedPurposes.append(purpose)
            return .success(())
        }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .success(()) }
    }

    private func tempDirectory() throws -> URL {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return tmp
    }

    @Test func mixedEcosystemGoesStraightToDetailsWithFastmailRecommended() {
        let model = EmailSetupModel(siteID: "s1", sourceDirectory: URL(fileURLWithPath: "/tmp"), domain: "", ops: FakeOps())
        model.choose(ecosystem: .mixedOrOther)
        guard case .details = model.step else {
            Issue.record("expected .details, got \(model.step)")
            return
        }
        #expect(model.recommendation?.provider == .fastmail)
        #expect(model.selectedProvider == .fastmail)
    }

    @Test func appleEcosystemAsksTierFirst() {
        let model = EmailSetupModel(siteID: "s1", sourceDirectory: URL(fileURLWithPath: "/tmp"), domain: "", ops: FakeOps())
        model.choose(ecosystem: .apple)
        guard case .appleTier = model.step else {
            Issue.record("expected .appleTier, got \(model.step)")
            return
        }
        model.choose(appleTier: .registeredBusiness)
        #expect(model.recommendation?.provider == .appleBusiness)
        guard case .details = model.step else {
            Issue.record("expected .details, got \(model.step)")
            return
        }
    }

    @Test func buildPlanMergesExistingSPFFromAnotherProvider() async throws {
        let existing = DNSRecord(
            id: "r1", type: "TXT", name: "example.com",
            content: "v=spf1 include:_spf.mx.cloudflare.net ~all", ttl: 1, proxied: false)
        let ops = FakeOps(existingRecords: [existing])
        let model = EmailSetupModel(siteID: "s1", sourceDirectory: try tempDirectory(), domain: "example.com", ops: ops)
        model.choose(ecosystem: .apple)
        model.choose(appleTier: .personal)
        model.dmarcReportEmail = "owner@example.com"
        model.buildPlan()
        repeat { await Task.yield() } while model.isRunning

        guard case .review(let plan, let spfWasMerged) = model.step else {
            Issue.record("expected .review, got \(model.step)")
            return
        }
        #expect(spfWasMerged)
        let spf = plan.records.first { $0.type == "TXT" && $0.name == "@" }
        #expect(spf?.content == "v=spf1 include:icloud.com include:_spf.mx.cloudflare.net ~all")
    }

    @Test func buildPlanLeavesPlanAloneWhenNoExistingSPF() async throws {
        let ops = FakeOps()
        let model = EmailSetupModel(siteID: "s1", sourceDirectory: try tempDirectory(), domain: "example.com", ops: ops)
        model.choose(ecosystem: .mixedOrOther)
        model.dmarcReportEmail = "owner@example.com"
        model.buildPlan()
        repeat { await Task.yield() } while model.isRunning

        guard case .review(_, let spfWasMerged) = model.step else {
            Issue.record("expected .review, got \(model.step)")
            return
        }
        #expect(!spfWasMerged)
    }

    @Test func applyAddsEveryRecordAndReportsResult() async throws {
        let ops = FakeOps()
        let model = EmailSetupModel(siteID: "s1", sourceDirectory: try tempDirectory(), domain: "example.com", ops: ops)
        model.choose(ecosystem: .mixedOrOther)
        model.dmarcReportEmail = "owner@example.com"
        model.buildPlan()
        repeat { await Task.yield() } while model.isRunning

        model.apply()
        repeat { await Task.yield() } while model.isRunning

        guard case .result(let result) = model.step else {
            Issue.record("expected .result, got \(model.step)")
            return
        }
        #expect(result.failures.isEmpty)
        #expect(result.addedCount == (await ops.addedTypes).count)
        #expect((await ops.addedPurposes).allSatisfy { $0 == "email:fastmail" })
    }
}
