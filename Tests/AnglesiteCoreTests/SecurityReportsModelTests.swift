import Testing
import Foundation
@testable import AnglesiteCore

@Suite("SecurityReportsModel (#975)")
@MainActor
struct SecurityReportsModelTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")

    private static let highAdvisory = SecurityAdvisory(
        id: "GHSA-1", summary: "High", severity: .high,
        htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-1")!, publishedAt: nil)
    private static let lowAlert = DependabotAlert(
        id: 1, packageName: "left-pad", ecosystem: "npm", severity: .low, patchedVersion: "1.0.0",
        htmlURL: URL(string: "https://github.com/acme/site/security/dependabot/1")!)

    /// Serves canned results or canned failures; each endpoint is controllable on its own so a
    /// test can fail one half of the check and leave the other succeeding.
    actor FakeReader: RepoAdvisoryReading {
        private let advisories: [SecurityAdvisory]
        private let alerts: [DependabotAlert]
        private let advisoriesFailure: GitHubRepoAPIError?
        private let alertsFailure: GitHubRepoAPIError?

        init(advisories: [SecurityAdvisory] = [], alerts: [DependabotAlert] = [],
             failure: GitHubRepoAPIError? = nil,
             advisoriesFailure: GitHubRepoAPIError? = nil, alertsFailure: GitHubRepoAPIError? = nil) {
            self.advisories = advisories
            self.alerts = alerts
            self.advisoriesFailure = advisoriesFailure ?? failure
            self.alertsFailure = alertsFailure ?? failure
        }

        func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] {
            if let advisoriesFailure { throw advisoriesFailure }
            return advisories
        }

        func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] {
            if let alertsFailure { throw alertsFailure }
            return alerts
        }
    }

    @Test("initial state is empty and clean")
    func initialState() {
        let model = SecurityReportsModel(reader: FakeReader())
        #expect(model.totalCount == 0)
        #expect(model.badgeState == .clean)
        #expect(model.lastCheckedAt == nil)
        #expect(!model.isRunning)
    }

    @Test("no repo clears state without an error and without a timestamp")
    func noRepoClears() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: nil, token: "tok").value
        #expect(model.totalCount == 0)
        #expect(model.lastError == nil)
        #expect(model.lastCheckedAt == nil)
    }

    @Test("no token clears state without an error")
    func noTokenClears() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: Self.repo, token: nil).value
        #expect(model.totalCount == 0)
        #expect(model.lastError == nil)
    }

    @Test("an empty token string is treated the same as no token")
    func emptyTokenClears() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: Self.repo, token: "").value
        #expect(model.totalCount == 0)
        #expect(model.lastError == nil)
    }

    @Test("a successful check populates both lists and clears any prior error")
    func successPopulates() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory], alerts: [Self.lowAlert]))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.openAdvisories == [Self.highAdvisory])
        #expect(model.openAlerts == [Self.lowAlert])
        #expect(model.totalCount == 2)
        #expect(model.lastError == nil)
        #expect(model.lastCheckedAt != nil)
        #expect(!model.isRunning)
    }

    @Test("badgeState is .failures when any open item is critical or high")
    func badgeStateFailures() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.badgeState == .failures)
    }

    @Test("badgeState is .warnings when the only open items are moderate/low/unknown")
    func badgeStateWarnings() async {
        let model = SecurityReportsModel(reader: FakeReader(alerts: [Self.lowAlert]))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.badgeState == .warnings)
    }

    @Test("a failed check sets lastError and leaves the lists empty")
    func failureSetsError() async {
        let model = SecurityReportsModel(reader: FakeReader(failure: .unauthorized(status: 401)))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.lastError != nil)
        #expect(model.totalCount == 0)
        #expect(model.lastCheckedAt != nil)
        #expect(!model.isRunning)
    }

    @Test("a failed Dependabot check still shows the advisories that fetched fine")
    func alertsFailureKeepsAdvisories() async {
        // GitHub answers the Dependabot endpoint with 403 whenever alerts are disabled for the
        // repository — an ordinary setting, which must not take the advisories down with it.
        let model = SecurityReportsModel(reader: FakeReader(
            advisories: [Self.highAdvisory], alerts: [Self.lowAlert], alertsFailure: .unauthorized(status: 403)))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.openAdvisories == [Self.highAdvisory])
        #expect(model.openAlerts.isEmpty)
        #expect(model.lastError != nil)
        // The remedy for a half-failure is never "recreate your token".
        #expect(model.lastError?.contains("Recreate it") != true)
        #expect(model.lastCheckedAt != nil)
        #expect(!model.isRunning)
    }

    @Test("a failed advisories check still shows the Dependabot alerts that fetched fine")
    func advisoriesFailureKeepsAlerts() async {
        let model = SecurityReportsModel(reader: FakeReader(
            advisories: [Self.highAdvisory], alerts: [Self.lowAlert], advisoriesFailure: .http(status: 500)))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.openAlerts == [Self.lowAlert])
        #expect(model.openAdvisories.isEmpty)
        #expect(model.lastError != nil)
        #expect(model.lastCheckedAt != nil)
        #expect(!model.isRunning)
    }

    @Test("both halves failing with 401 sends the user to recreate their token")
    func bothFailWith401RecommendsTokenRecreation() async {
        let model = SecurityReportsModel(reader: FakeReader(failure: .unauthorized(status: 401)))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.lastError?.contains("Recreate it") == true)
    }

    /// Both endpoints can 403 for unrelated repo-config reasons (e.g. Dependabot alerts are off
    /// AND the token happens to lack advisories scope) — that pairing must not claim the token
    /// itself needs recreating, since it may already be correctly scoped (#1312).
    @Test("both halves failing with 403 does not claim the token needs recreating")
    func bothFailWith403DoesNotRecommendTokenRecreation() async {
        let model = SecurityReportsModel(reader: FakeReader(failure: .unauthorized(status: 403)))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.lastError?.contains("Recreate it") == false)
        #expect(model.lastError != nil)
    }

    @Test("a 401 on one half and a 403 on the other still recommends recreating the token")
    func mixed401And403RecommendsTokenRecreation() async {
        let model = SecurityReportsModel(reader: FakeReader(
            advisoriesFailure: .unauthorized(status: 401), alertsFailure: .unauthorized(status: 403)))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.lastError?.contains("Recreate it") == true)
    }

    /// A lone 403 paired with an *unrelated* failure on the other half (not itself an
    /// `.unauthorized`) is the asymmetric case the (403, 403) test above doesn't cover: the 403
    /// half can still just mean a repo-config setting, so the pairing must not fall through to
    /// `wholeCheckMessage(for:)`'s status-blind `.unauthorized` arm and claim the token is at
    /// fault (#1312).
    @Test("a 403 on one half paired with an unrelated failure on the other does not recommend recreating the token")
    func lone403WithUnrelatedFailureDoesNotRecommendTokenRecreation() async {
        let model = SecurityReportsModel(reader: FakeReader(
            advisoriesFailure: .unauthorized(status: 403), alertsFailure: .network))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.lastError?.contains("Recreate it") == false)
        #expect(model.lastError != nil)
    }

    @Test("recheck cancels a prior in-flight run and discards its stale result")
    func recheckCancelsPrior() async {
        // The first call's fetch is slow and returns data distinguishable from the second
        // (superseding) call's — so this proves the superseded run's result never lands in
        // `openAdvisories`, not merely that both Tasks finish without hanging or crashing (that
        // weaker check passed even before the `Task.isCancelled` guard existed).
        actor CountingReader: RepoAdvisoryReading {
            private var callCount = 0
            private let staleAdvisory: SecurityAdvisory
            init(staleAdvisory: SecurityAdvisory) { self.staleAdvisory = staleAdvisory }
            func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] {
                callCount += 1
                guard callCount == 1 else { return [] }
                try await Task.sleep(nanoseconds: 200_000_000)
                return [staleAdvisory]
            }
            func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] {
                []
            }
        }
        let model = SecurityReportsModel(reader: CountingReader(staleAdvisory: Self.highAdvisory))
        let first = model.recheck(repo: Self.repo, token: "tok")
        let second = model.recheck(repo: Self.repo, token: "tok")
        await first.value
        await second.value
        #expect(!model.isRunning)
        #expect(model.openAdvisories.isEmpty)
    }
}
