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

    // MARK: - Status observation (QA §1)

    /// QA §1.1: automates the "toolbar sync icon shows `Syncing…` … then `Synced`" observation,
    /// which the manual checklist can only make by eye. Exercises the `onStatusChange` seam that
    /// `SiteWindow`/`SyncModel` actually consume, so the *order* of the transitions is asserted,
    /// not just the terminal status.
    @Test("a successful push reports syncing then synced through the status observer")
    func statusObserverReportsSyncingThenSynced() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        await engine.set(pushResult: .pushed(refs: []))
        let recorder = StatusRecorder()
        let scheduler = SyncScheduler(
            package: package, engine: engine, pushDebounce: .zero,
            onStatusChange: { recorder.record($0) })

        await scheduler.backupCompleted()
        try await waitUntil { await engine.pushCount == 1 }
        try await waitUntil { recorder.statuses().count == 2 }

        let observed = recorder.statuses()
        guard observed.count == 2 else {
            Issue.record("expected exactly 2 status changes, got \(observed)")
            return
        }
        #expect(observed[0] == .syncing)
        guard case .synced = observed[1] else {
            Issue.record("expected .synced after .syncing, got \(observed[1])")
            return
        }
    }

    /// QA §1.1: the `Synced` toolbar state renders "synced N minutes ago" from the date carried in
    /// `.synced(_)`. Pinning the injected clock is the only way to assert that date is the moment
    /// the sync completed rather than, say, a stale value carried over from an earlier transition.
    @Test("the injected clock stamps the synced status with exactly that date")
    func injectedClockStampsSyncedDate() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let fixed = Date(timeIntervalSince1970: 1_700_000_000)
        let scheduler = SyncScheduler(package: package, engine: engine, now: { fixed })

        let status = await scheduler.siteOpened()
        #expect(status == .synced(fixed))
    }

    // MARK: - Pull outcomes that are still "synced" (QA §1.3, §2.2)

    /// QA §1.3 (clean fast-forward on reopen) and §2.2 (`merged` after true concurrent edits):
    /// both steps expect the toolbar to settle on `Synced` with no banner, even though the pull
    /// did real work. Also covers `.bootstrapped` (fresh peer / repaired repo) and `.localAhead`
    /// (nothing to pull), which `runPull` folds into the same `.synced` case.
    @Test("merged/fastForwarded/bootstrapped/localAhead pulls all report synced")
    func nonUpToDatePullResultsReportSynced() async throws {
        let package = try makePackage()
        let fixed = Date(timeIntervalSince1970: 1_700_000_000)
        let results: [SyncEngine.PullResult] = [
            .merged(branch: "main", mergedTips: ["icloud", "peer-1"]),
            .fastForwarded(branch: "main", from: "aaa", to: "bbb"),
            .bootstrapped(branch: "main"),
            .localAhead(branch: "main"),
        ]

        for result in results {
            let engine = FakeEngine()
            await engine.set(pullResult: result)
            let scheduler = SyncScheduler(package: package, engine: engine, now: { fixed })

            let status = await scheduler.siteOpened()
            guard case .synced(let date) = status else {
                Issue.record("expected .synced for \(result), got \(status)")
                continue
            }
            #expect(date == fixed)
        }
    }

    // MARK: - Push failure and recovery (QA §3)

    /// QA §3.2: editing while offline, where the debounced push can't reach iCloud. The checklist
    /// asks the tester to "note exactly what it shows"; this pins the answer to `.failed(reason:)`
    /// with the engine's own owner-readable prose preserved verbatim, so the toolbar never shows a
    /// generic failure in place of the real one.
    @Test("a failed push surfaces failed with the engine's reason preserved")
    func failedPushSurfacesFailure() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        await engine.set(pushResult: .failed(reason: "couldn't reach iCloud"))
        let scheduler = SyncScheduler(package: package, engine: engine, pushDebounce: .zero)

        await scheduler.backupCompleted()
        try await waitUntil { await engine.pushCount == 1 }
        try await waitUntil { await scheduler.currentStatus() == .failed(reason: "couldn't reach iCloud") }
        #expect(await scheduler.currentStatus() == .failed(reason: "couldn't reach iCloud"))
    }

    /// QA §3.4: reconnecting Wi-Fi must resume syncing with **no manual action** — the pass
    /// criteria explicitly note there is no "sync now" button by design. A scheduler that latched
    /// `.failed` and refused later triggers would break that, so this drives a failed push and
    /// then an ordinary later trigger, and asserts the second push actually runs and lands on
    /// `.synced`.
    @Test("a trigger after a failed push recovers to synced with no manual action")
    func retryAfterFailedPushSucceeds() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        await engine.set(pushResult: .failed(reason: "offline"))
        let scheduler = SyncScheduler(package: package, engine: engine, pushDebounce: .zero)

        await scheduler.backupCompleted()
        try await waitUntil { await scheduler.currentStatus() == .failed(reason: "offline") }

        await engine.set(pushResult: .pushed(refs: []))
        await scheduler.deployCompleted()
        try await waitUntil { await engine.pushCount == 2 }
        try await waitUntil {
            if case .synced = await scheduler.currentStatus() { return true }
            return false
        }
    }

    /// QA §3 hygiene: closing a site window (or quitting, §1.2) calls `stop()`, and a debounce
    /// still counting down must not fire a push afterwards. Not directly observable by hand — the
    /// manual checklist can only note the absence of a `sync:push` line — so it's asserted here.
    @Test("stop() cancels a pending debounce so no push ever runs")
    func stopCancelsPendingDebounce() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let gate = ManualDebounceGate()
        let scheduler = SyncScheduler(
            package: package, engine: engine, pushDebounce: .milliseconds(250),
            sleep: { _ in
                await gate.sleep()
                // Production's `Task.sleep(for:)` throws `CancellationError` once the debounce
                // Task is cancelled; `ManualDebounceGate` alone doesn't model cancellation (see
                // `pushTriggersCoalesce`'s note), so mirror that half of the real seam explicitly.
                // Without it the fake sleep would return normally after `stop()` and `beginPush()`
                // would still fire — testing the gate rather than `stop()`.
                try Task.checkCancellation()
            })

        await scheduler.backupCompleted()
        try await waitUntil { await gate.armedCount() == 1 }
        await scheduler.stop()
        await gate.release()

        // Negative assertion, so there's no state to wait *for*: settle briefly and assert nothing
        // happened, exactly as `idleSchedulerTouchesNothing` does.
        try await Task.sleep(for: .milliseconds(50))
        #expect(await engine.pushCount == 0)
    }

    // MARK: - Conflict resolution (QA §2.7, §2.8)

    /// QA §2.7/§2.8: after the resolution sheet applies a side, the toolbar must leave
    /// `N files need attention` and return to `Syncing…` → `Synced`, and the other Mac must
    /// converge on its next pull. `conflictResolved()` is the app-side hook for that — it re-pulls
    /// and re-derives status from the fresh result rather than clearing `.needsAttention` locally.
    /// Note it does *not* itself call `acknowledgeConflictResolved(package:)`; per its doc comment
    /// the caller (`SyncConflictResolver`) has already done so before invoking it, so
    /// `acknowledgedCount` stays 0 here.
    @Test("conflictResolved() re-pulls and clears needsAttention once the resolution landed")
    func conflictResolvedRepullsAndClears() async throws {
        let package = try makePackage()
        let engine = FakeEngine()
        let conflict = SyncEngine.SyncConflict(
            branch: "main", conflictedPaths: ["file.txt"], ourOID: "aaa", theirOID: "bbb", theirSource: "icloud")
        await engine.set(pullResult: .conflicted(conflict))
        let fixed = Date(timeIntervalSince1970: 1_700_000_000)
        let scheduler = SyncScheduler(package: package, engine: engine, now: { fixed })

        #expect(await scheduler.siteOpened() == .needsAttention(conflict))

        // The resolution merge commit is now local history the artifact doesn't have yet, so the
        // engine's next pull reports `.localAhead` — still a clean, banner-free state.
        await engine.set(pullResult: .localAhead(branch: "main"))
        let status = await scheduler.conflictResolved()
        #expect(await engine.pullCount == 2)
        #expect(status == .synced(fixed))
        #expect(await engine.acknowledgedCount == 0)
    }

    // MARK: - Helpers

    /// Ordered sink for `SyncScheduler.StatusObserver`. `StatusObserver` is a synchronous
    /// `@Sendable (Status) -> Void` invoked inline inside the scheduler's own isolation, so it
    /// can't `await` — which rules out an actor here (that would force `Task { await record(…) }`,
    /// and `Task` ordering is non-deterministic, breaking the transition-order assertion). A plain
    /// lock is the right tool for a synchronous concurrent sink; mirrors
    /// `DeployCommandProgressTests.ProgressRecorder`.
    private final class StatusRecorder: @unchecked Sendable {
        private let lock = NSLock()
        private var items: [SyncScheduler.Status] = []
        func record(_ s: SyncScheduler.Status) { lock.lock(); items.append(s); lock.unlock() }
        func statuses() -> [SyncScheduler.Status] { lock.lock(); defer { lock.unlock() }; return items }
    }

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
