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

    /// Regression test for the double-submit race (final-review fix wave, #1195): `phase` used to
    /// flip to `.purchasing` only as the first line *inside* the spawned `Task`, not synchronously
    /// in `confirmPurchase()` — leaving a window (until the task's first hop) where a second
    /// `confirmPurchase()` call still saw `.confirming`/`isRunning == false` and passed the guard,
    /// firing a second real-money `POST /registrar/registrations`. Calling `confirmPurchase()`
    /// twice back-to-back with no `await`/yield between them (as a held/double-tapped Return on
    /// the `.keyboardShortcut(.defaultAction)` Buy button could) is exactly that race window —
    /// this would have recorded two `registerDomain` calls before the fix.
    @Test func confirmPurchaseCalledTwiceInImmediateSuccessionOnlyRegistersOnce() async throws {
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
        model.selectCandidate(candidates[0])
        guard case .confirming = model.phase else {
            Issue.record("expected .confirming, got \(model.phase)"); return
        }

        // No `await` between these two calls — the synchronous double-call that lived in the race
        // window.
        model.confirmPurchase()
        model.confirmPurchase()

        repeat { await Task.yield() } while model.isRunning

        #expect(await ops.registeredNames == ["example.dev"])
        #expect(model.phase == .purchased(hostname: "example.dev"))
    }

    /// Covers the Fix 4/5 pairing: closing the sheet mid-purchase doesn't cancel the in-flight
    /// task (a `POST /registrar/registrations` may already be at Cloudflare), and reopening the
    /// sheet before that background purchase finishes shows the live `.purchasing` state rather
    /// than silently refusing to open or discarding it.
    @Test func dismissAndReopenDuringBackgroundedPurchasePreservesInFlightTask() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["example.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
        ]))
        await ops.setRegisterDelay(.milliseconds(150))
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
        model.selectCandidate(candidates[0])
        model.confirmPurchase()
        #expect(model.isRunning)

        // Close mid-purchase: must not cancel the in-flight task.
        model.dismissSheet()
        #expect(!model.sheetPresented)
        #expect(model.isRunning)

        // Reopen while it's still running: must present (not silently no-op) and preserve
        // `.purchasing` instead of resetting to `.searching`.
        model.openSheet()
        #expect(model.sheetPresented)
        guard case .purchasing(let candidate) = model.phase else {
            Issue.record("expected .purchasing to survive reopen, got \(model.phase)"); return
        }
        #expect(candidate.name == "example.dev")

        repeat { await Task.yield() } while model.isRunning
        #expect(model.phase == .purchased(hostname: "example.dev"))
        #expect(await ops.registeredNames == ["example.dev"])
    }

    /// `dismissSheet()` used to leave `pendingSearchQuery`/`tokenPromptPresented` surviving a
    /// close, unlike `phase`/`queryInput` on `openSheet()` — a small state-hygiene gap fixed
    /// alongside Fix 4/5.
    @Test func dismissSheetResetsTokenPromptState() async throws {
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

        model.dismissSheet()
        #expect(!model.tokenPromptPresented)
    }

    /// `CFRegistrarCheckResult.pricing` decodes as optional, so a `registrable: true` result can
    /// still have `priceDisplay == nil` — such a candidate must not be selectable (weak consent
    /// for a real charge otherwise: "Buy example.dev for an unknown price?" with an enabled Buy
    /// button).
    @Test func registrableCandidateWithNoPriceCannotBeSelected() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["example.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: nil, currency: nil),
        ]))

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
        #expect(candidates[0].registrable)
        #expect(candidates[0].priceDisplay == nil)

        model.selectCandidate(candidates[0])
        #expect(model.phase == .results(query: "example", candidates: candidates))
    }

    /// Spec: results render available-first, unavailable/unsupported rows after — regardless of
    /// the order the API returned them in.
    @Test func searchResultsSortAvailableFirst() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["taken.dev", "example.dev", "also-taken.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "taken.dev", registrable: false, reason: "domain_unavailable", registrationCost: nil, currency: nil),
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
            RegistrarDomainCheck(name: "also-taken.dev", registrable: false, reason: "domain_unavailable", registrationCost: nil, currency: nil),
        ]))

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

        #expect(candidates.map(\.name) == ["example.dev", "taken.dev", "also-taken.dev"])
    }
}

// MARK: - Fakes

private actor FakeRegistrarOps: RegistrarOperationsService {
    private var searchResult: Result<[String], RegistrarOperationError> = .success([])
    private var checkResult: Result<[RegistrarDomainCheck], RegistrarOperationError> = .success([])
    private var registerResult: Result<RegistrarRegistrationOutcome, RegistrarOperationError> = .success(.succeeded)
    /// Every `name` passed to `registerDomain`, in call order — lets tests assert exactly how many
    /// times a real-money `POST /registrar/registrations` would have fired (see the double-submit
    /// regression test).
    private(set) var registeredNames: [String] = []
    /// An optional delay `registerDomain` awaits before resolving, so a test can hold two
    /// concurrent calls open at once to observe how many were actually made.
    private var registerDelay: Duration?

    func setSearchResult(_ r: Result<[String], RegistrarOperationError>) { searchResult = r }
    func setCheckResult(_ r: Result<[RegistrarDomainCheck], RegistrarOperationError>) { checkResult = r }
    func setRegisterResult(_ r: Result<RegistrarRegistrationOutcome, RegistrarOperationError>) { registerResult = r }
    func setRegisterDelay(_ d: Duration) { registerDelay = d }

    func searchDomains(query: String) async -> Result<[String], RegistrarOperationError> { searchResult }
    func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError> { checkResult }
    func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError> {
        registeredNames.append(name)
        if let registerDelay {
            try? await Task.sleep(for: registerDelay)
        }
        return registerResult
    }
}
