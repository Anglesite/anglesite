import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@MainActor
@Suite struct BuyDomainModelTests {
    private func makeSite() throws -> (site: CurrentSite, dir: URL) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return (CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp), tmp)
    }

    @Test func happyPathSearchThenPurchaseRecordsTransferIntent() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["example.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
        ]))
        await ops.setRegisterResult(.success(.succeeded))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.queryInput = "example"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning

        guard case .results(_, let candidates) = model.phase else {
            Issue.record("expected .results, got \(model.phase)"); return
        }
        #expect(candidates.count == 1)
        #expect(candidates[0].registrable)
        #expect(candidates[0].priceDisplay == "$10.11/yr")

        model.selectCandidate(candidates[0])
        guard case .confirming(let candidate) = model.phase else {
            Issue.record("expected .confirming, got \(model.phase)"); return
        }

        model.confirmPurchase()
        repeat { await Task.yield() } while model.isRunning

        #expect(model.phase == .purchased(hostname: "example.dev"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=transfer"))
        #expect(config.contains("DOMAIN=example.dev"))
        _ = candidate
    }

    @Test func unregistrableCandidateCannotBeSelected() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["taken.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "taken.dev", registrable: false, reason: "domain_unavailable", registrationCost: nil, currency: nil),
        ]))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.queryInput = "taken"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning

        guard case .results(_, let candidates) = model.phase else {
            Issue.record("expected .results, got \(model.phase)"); return
        }
        model.selectCandidate(candidates[0])
        #expect(model.phase == .results(query: "taken", candidates: candidates))
    }

    @Test func registerOutcomeActionRequiredDoesNotPersist() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["example.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
        ]))
        await ops.setRegisterResult(.success(.actionRequired))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.queryInput = "example"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning
        guard case .results(_, let candidates) = model.phase else { Issue.record("expected .results"); return }
        model.selectCandidate(candidates[0])
        model.confirmPurchase()
        repeat { await Task.yield() } while model.isRunning

        #expect(model.phase == .needsAccountSetup(hostname: "example.dev"))
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent(".site-config").path))
    }

    @Test func noTokenPresentsTokenPromptAndRecordsPendingQuery() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.failure(.noToken))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.queryInput = "example"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning

        #expect(model.tokenPromptPresented)
    }
}

// MARK: - Fakes

private actor FakeRegistrarOps: RegistrarOperationsService {
    private var searchResult: Result<[String], RegistrarOperationError> = .success([])
    private var checkResult: Result<[RegistrarDomainCheck], RegistrarOperationError> = .success([])
    private var registerResult: Result<RegistrarRegistrationOutcome, RegistrarOperationError> = .success(.succeeded)

    func setSearchResult(_ r: Result<[String], RegistrarOperationError>) { searchResult = r }
    func setCheckResult(_ r: Result<[RegistrarDomainCheck], RegistrarOperationError>) { checkResult = r }
    func setRegisterResult(_ r: Result<RegistrarRegistrationOutcome, RegistrarOperationError>) { registerResult = r }

    func searchDomains(query: String) async -> Result<[String], RegistrarOperationError> { searchResult }
    func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError> { checkResult }
    func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError> { registerResult }
}
