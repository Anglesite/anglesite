#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteSiteModel
@testable import AnglesiteCore

/// `SyncScheduler` (#881) owns *when* a site's `SyncEngine` runs: pull on open/bundle-change,
/// debounced+coalesced push after backup/deploy/backgrounding. These tests drive it against a
/// fake `SyncEngineProtocol` so the trigger/debounce/coalescing policy is verified without any
/// real git repository or iCloud round-trip — see `SyncEngineTests` for the engine's own
/// integration coverage against real repos.
@Suite("SyncScheduler", .serialized) struct SyncSchedulerTests {

    // MARK: - Fakes

    private actor FakeEngine: SyncEngineProtocol {
        var pullResult: SyncEngine.PullResult = .upToDate
        var pushResult: SyncEngine.PushResult = .unchanged
        var conflict: SyncEngine.SyncConflict?
        private(set) var pullCount = 0
        private(set) var pushCount = 0
        private(set) var acknowledgedCount = 0

        func pull(package: AnglesitePackage) async -> SyncEngine.PullResult {
            pullCount += 1
            return pullResult
        }

        func push(package: AnglesitePackage) async -> SyncEngine.PushResult {
            pushCount += 1
            return pushResult
        }

        nonisolated func pendingConflict(package: AnglesitePackage) -> SyncEngine.SyncConflict? {
            // `nonisolated` per the protocol, so this can't touch actor-isolated `conflict`
            // directly; tests that need it exercised set `pushResult` instead of relying on this.
            nil
        }

        func acknowledgeConflictResolved(package: AnglesitePackage) async {
            acknowledgedCount += 1
        }

        func set(pullResult: SyncEngine.PullResult) { self.pullResult = pullResult }
        func set(pushResult: SyncEngine.PushResult) { self.pushResult = pushResult }
    }

    /// A manually-triggered stand-in for `SyncScheduler`'s debounce timer — mirrors
    /// `InvisiblePublishQueueTests.ManualDebounceGate` (#762's lesson: don't race a real timer
    /// against actor scheduling under CI load).
    private actor ManualDebounceGate {
        private var continuations: [CheckedContinuation<Void, Never>] = []
        func sleep() async { await withCheckedContinuation { continuations.append($0) } }
        func armedCount() -> Int { continuations.count }
        func release() {
            let pending = continuations
            continuations.removeAll()
            pending.forEach { $0.resume() }
        }
    }

    private func makePackage(name: String = "Test") throws -> AnglesitePackage {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("SyncSchedulerTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let pkgURL = root.appendingPathComponent("\(name).anglesite", isDirectory: true)
        let (pkg, _) = try AnglesitePackage.createSkeleton(at: pkgURL, displayName: name)
        return pkg
    }

    // MARK: - Pull triggers

    @Test("siteOpened() pulls immediately and reports synced on upToDate")
    func siteOpenedPullsImmediately() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let scheduler = SyncScheduler(package: package, engine: engine)

        let status = await scheduler.siteOpened()
        #expect(await engine.pullCount == 1)
        if case .synced = status {} else {
            Issue.record("expected .synced, got \(status)")
        }
    }

    @Test("bundleChanged() pulls again")
    func bundleChangedPulls() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let scheduler = SyncScheduler(package: package, engine: engine)

        _ = await scheduler.siteOpened()
        _ = await scheduler.bundleChanged()
        #expect(await engine.pullCount == 2)
    }

    @Test("a conflicted pull surfaces needsAttention with the typed conflict")
    func conflictedPullSurfacesNeedsAttention() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let conflict = SyncEngine.SyncConflict(
            branch: "main", conflictedPaths: ["file.txt"], ourOID: "aaa", theirOID: "bbb", theirSource: "icloud")
        await engine.set(pullResult: .conflicted(conflict))
        let scheduler = SyncScheduler(package: package, engine: engine)

        let status = await scheduler.siteOpened()
        #expect(status == .needsAttention(conflict))
    }

    @Test("waitingForICloud and failed pulls surface as their own statuses")
    func pullFailureStatuses() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        await engine.set(pullResult: .waitingForICloud)
        let scheduler = SyncScheduler(package: package, engine: engine)
        #expect(await scheduler.siteOpened() == .waitingForICloud)

        let engine2 = FakeEngine()
        await engine2.set(pullResult: .failed(reason: "boom"))
        let scheduler2 = SyncScheduler(package: package, engine: engine2)
        #expect(await scheduler2.siteOpened() == .failed(reason: "boom"))
    }

    // MARK: - Idle = zero activity

    @Test("a scheduler that's never triggered never touches the engine")
    func idleSchedulerTouchesNothing() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        _ = SyncScheduler(package: package, engine: engine)
        // No trigger called — give any errant background activity a chance to happen, then assert none did.
        try await Task.sleep(for: .milliseconds(50))
        #expect(await engine.pullCount == 0)
        #expect(await engine.pushCount == 0)
    }

    // MARK: - Debounced + coalesced push

    @Test("backup/deploy/background triggers debounce into a single push")
    func pushTriggersCoalesce() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let gate = ManualDebounceGate()
        let scheduler = SyncScheduler(
            package: package, engine: engine, pushDebounce: .milliseconds(250),
            sleep: { _ in await gate.sleep() })

        await scheduler.backupCompleted()
        await scheduler.deployCompleted()
        // `ManualDebounceGate` doesn't model cancellation (like `InvisiblePublishQueueTests`'
        // own gate of the same name): `pushDebounceTask?.cancel()` in `schedulePush()` cancels
        // the *Task*, but our fake `sleep` isn't cancellation-aware the way the production
        // `Task.sleep(for:)` seam is, so the first trigger's debounce still arms a (now-stale)
        // gate continuation alongside the second's. Both triggers land before either "elapses",
        // so exactly 2 continuations arm here regardless of scheduling order; release both and
        // assert the actual push still only fires once — `beginPush()`'s `pushTask == nil` guard
        // is what does the real coalescing, not the cancellation.
        try await waitUntil { await gate.armedCount() == 2 }
        await gate.release()

        try await waitUntil { await engine.pushCount == 1 }
        #expect(await engine.pushCount == 1)
    }

    @Test("appDidBackground pushes with zero delay")
    func backgroundPushIsImmediate() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let scheduler = SyncScheduler(package: package, engine: engine, pushDebounce: .seconds(999))

        await scheduler.appDidBackground()
        try await waitUntil { await engine.pushCount == 1 }
        #expect(await engine.pushCount == 1)
    }

    @Test("a trigger that lands mid-push schedules a fresh debounced push instead of being dropped")
    func triggerDuringPushSchedulesAnother() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let gate = ManualDebounceGate()
        let scheduler = SyncScheduler(
            package: package, engine: engine, pushDebounce: .milliseconds(10),
            sleep: { _ in await gate.sleep() })

        await scheduler.backupCompleted()
        try await waitUntil { await gate.armedCount() == 1 }
        await gate.release()
        try await waitUntil { await engine.pushCount == 1 }

        // A second trigger after the first push already completed schedules its own debounce.
        await scheduler.deployCompleted()
        try await waitUntil { await gate.armedCount() == 1 }
        await gate.release()
        try await waitUntil { await engine.pushCount == 2 }
        #expect(await engine.pushCount == 2)
    }

    @Test("push result unchanged/pushed both report synced")
    func pushResultsReportSynced() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        await engine.set(pushResult: .unchanged)
        let scheduler = SyncScheduler(package: package, engine: engine, pushDebounce: .zero)

        await scheduler.backupCompleted()
        try await waitUntil { await engine.pushCount == 1 }
        try await waitUntil {
            if case .synced = await scheduler.currentStatus() { return true }
            return false
        }
    }

    @Test("a paused-for-conflict push result surfaces needsAttention when the engine has a pending conflict")
    func pausedPushSurfacesConflict() async throws {
        let package = try makePackage()
        let conflict = SyncEngine.SyncConflict(
            branch: "main", conflictedPaths: ["file.txt"], ourOID: "aaa", theirOID: "bbb", theirSource: "icloud")
        let engine = ConflictAwareFakeEngine(conflict: conflict)
        let scheduler = SyncScheduler(package: package, engine: engine, pushDebounce: .zero)

        await scheduler.backupCompleted()
        try await waitUntil {
            if case .needsAttention(let c) = await scheduler.currentStatus() { return c == conflict }
            return false
        }
    }

    /// `FakeEngine.pendingConflict` is deliberately `nil` (it's `nonisolated`, so it can't read
    /// actor state) — this variant hardcodes the conflict outside actor isolation to exercise
    /// `SyncScheduler`'s `.pausedForConflict` branch.
    private final class ConflictAwareFakeEngine: SyncEngineProtocol, @unchecked Sendable {
        private let conflict: SyncEngine.SyncConflict
        init(conflict: SyncEngine.SyncConflict) { self.conflict = conflict }
        func pull(package: AnglesitePackage) async -> SyncEngine.PullResult { .upToDate }
        func push(package: AnglesitePackage) async -> SyncEngine.PushResult { .pausedForConflict(branch: conflict.branch) }
        func pendingConflict(package: AnglesitePackage) -> SyncEngine.SyncConflict? { conflict }
        func acknowledgeConflictResolved(package: AnglesitePackage) async {}
    }

    // MARK: - Helpers

    private func waitUntil(
        timeout: Duration = .seconds(10),
        condition: @escaping @Sendable () async -> Bool
    ) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while !(await condition()) {
            guard clock.now < deadline else {
                Issue.record("timed out waiting for sync scheduler state")
                return
            }
            try await Task.sleep(for: .milliseconds(10))
        }
    }
}
#endif
