#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

/// `UbiquitousVersionStore` is the production `VersionStore` `SyncEngine` uses to make sure the
/// sync artifact is really on disk (and to enumerate iCloud's `NSFileVersion` conflict copies)
/// before reading it — the seam behind manual QA §4 ("Optimize Mac Storage" eviction).
///
/// **Scope.** Real eviction and real `NSFileVersion` conflict versions can't be manufactured off
/// real iCloud: `startDownloadingUbiquitousItem` needs a ubiquity container, and a conflict version
/// only exists after two Macs write the same ubiquitous item concurrently. So QA §4's `.downloaded`
/// and `.timedOut` outcomes, and any non-empty `conflictVersions(of:)` result, stay manual — every
/// other suite in this codebase fakes this protocol instead (`SyncEngineTests.FakeVersionStore`).
/// What *is* testable here is the non-ubiquitous short-circuit (the branch that makes those fakes'
/// hosts — real repos in temp directories — behave like plain local files) and
/// `ConflictVersionHandle`'s value semantics, which `SyncEngine.reconcileDivergence` relies on.
///
/// No libgit2 here (plain temp files only), so this suite is unserialized, following
/// `RepoRelocatorInteropTests`' precedent.
@Suite("VersionStore")
struct VersionStoreTests {

    // MARK: - Fixtures

    /// Box for a call count an `@escaping @Sendable` closure can mutate — a `markResolved` closure
    /// can't capture a mutable local.
    private final class CallCounter: @unchecked Sendable {
        private(set) var count = 0
        func record() { count += 1 }
    }

    private func makeTempFile(prefix: String, name: String = "source.bundle") throws -> URL {
        let dir = try makeTempDir(prefix: prefix)
        let url = dir.appendingPathComponent(name, isDirectory: false)
        try "artifact bytes".write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    // MARK: - materialize()

    /// QA §4.3: the eviction path's precondition — a file that is *not* evicted (here, not
    /// ubiquitous at all) must short-circuit to `.alreadyLocal` with no download and no wait. This
    /// is the branch every other sync test in this codebase depends on, since their packages live
    /// in temp directories rather than a ubiquity container.
    @Test("materialize short-circuits to alreadyLocal for a plain non-ubiquitous file")
    func materializeNonUbiquitousFileIsAlreadyLocal() async throws {
        let url = try makeTempFile(prefix: "version-store-local")
        let store = UbiquitousVersionStore(pollInterval: 0.01)

        let outcome = await store.materialize(at: url, timeout: 0.1)
        #expect(outcome == .alreadyLocal)
    }

    /// QA §4.3: a URL with no file at all reports `.alreadyLocal`, not `.timedOut` — reading its
    /// downloading status throws, `downloadingStatus(of:)` swallows that as `nil`, and the guard
    /// treats "no ubiquitous status" as "nothing to wait for". That's what keeps `SyncEngine.push`
    /// from stalling for the full `materializeTimeout` on a package whose artifact hasn't been
    /// written yet; existence is the *caller's* precondition to check, not this store's.
    @Test("materialize on a missing file reports alreadyLocal rather than waiting out the timeout")
    func materializeMissingFileIsAlreadyLocal() async throws {
        let dir = try makeTempDir(prefix: "version-store-missing")
        let missing = dir.appendingPathComponent("source.bundle", isDirectory: false)
        #expect(!FileManager.default.fileExists(atPath: missing.path), "precondition: nothing at this path")
        let store = UbiquitousVersionStore(pollInterval: 0.01)

        let outcome = await store.materialize(at: missing, timeout: 0.1)
        #expect(outcome == .alreadyLocal)
    }

    // MARK: - conflictVersions()

    /// QA §2.8 / §5: "no conflict" is the overwhelmingly common case, and a non-iCloud file can
    /// never have an `NSFileVersion` conflict copy — so enumeration must come back empty rather
    /// than nil-crashing or inventing a peer namespace for `SyncEngine` to fetch into.
    @Test("conflictVersions is empty for a plain non-ubiquitous file")
    func conflictVersionsEmptyForNonUbiquitousFile() async throws {
        let url = try makeTempFile(prefix: "version-store-conflicts")
        let store = UbiquitousVersionStore(pollInterval: 0.01)

        let versions = await store.conflictVersions(of: url)
        #expect(versions.isEmpty)
    }

    // MARK: - ConflictVersionHandle

    /// QA §2.8: resolving a conflict version is what stops it coming back as a repeat conflict on
    /// the next pull. `SyncEngine` calls `markResolved()` exactly once per fully-converged tip, so
    /// the handle must forward that call straight through — not swallow it, not replay it.
    @Test("markResolved invokes the injected closure exactly once")
    func markResolvedInvokesClosureOnce() throws {
        let url = try makeTempFile(prefix: "version-store-handle")
        let counter = CallCounter()
        let handle = ConflictVersionHandle(id: "peer-0", contentURL: url) { counter.record() }

        #expect(counter.count == 0, "constructing a handle must not resolve anything")
        handle.markResolved()
        #expect(counter.count == 1)
    }

    /// QA §2.8: `SyncEngine.reconcileDivergence` keys handles by source id and compares them, so
    /// identity has to be `id` + `contentURL` only — two handles pointing at the same conflict copy
    /// are the same conflict copy regardless of which closure was wired to them.
    @Test("ConflictVersionHandle equality compares id and contentURL, ignoring the closure")
    func handleEqualityIgnoresClosure() throws {
        let url = try makeTempFile(prefix: "version-store-equality")
        let otherURL = url.deletingLastPathComponent().appendingPathComponent("other.bundle", isDirectory: false)
        let counter = CallCounter()

        let handle = ConflictVersionHandle(id: "peer-0", contentURL: url) {}
        let sameWithDifferentClosure = ConflictVersionHandle(id: "peer-0", contentURL: url) { counter.record() }
        let differentID = ConflictVersionHandle(id: "peer-1", contentURL: url) {}
        let differentURL = ConflictVersionHandle(id: "peer-0", contentURL: otherURL) {}

        #expect(handle == sameWithDifferentClosure)
        #expect(handle != differentID)
        #expect(handle != differentURL)
        #expect(counter.count == 0, "comparing handles must never invoke their closures")
    }
}
#endif
