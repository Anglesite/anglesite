# Server Debug Panel (#699) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Debug Pane a per-site "Local Workers" status block (running/restarting/failed + local URL) and move wrangler-dev output to its own filterable `worker:<siteID>` log source.

**Architecture:** A new `WorkersDevStatusCenter` actor in AnglesiteCore (mirroring `LogCenter`'s publish/snapshot/subscribe-with-replay shape) receives status from `LocalContainerSiteRuntime`, which learns supervisor transitions through a new defaulted `onState:` variant of `LocalContainerControl.startWorkersDev`. `DebugPaneView` subscribes and renders rows in its existing Server section.

**Tech Stack:** Swift 6.4 / SwiftUI (Apple frameworks only), Swift Testing, SwiftPM + XcodeGen.

**Spec:** `docs/superpowers/specs/2026-07-30-server-debug-panel-design.md`

## Global Constraints

- Worktree: run `xcodegen generate` before any `xcodebuild`; use `scripts/build-app.sh`, never raw `xcodebuild`.
- AnglesiteCore builds on Linux CI — no Darwin-only API in any `Sources/AnglesiteCore/` change.
- No new dependencies; plain SwiftUI + actors.
- Conventional commits, subject ≤72 chars, issue number in subject.
- New user-visible strings require the String Catalog CLI sync (CONTRIBUTING.md ▸ "Commit String Catalog updates"), scoped to THIS worktree's BUILD_DIR — never a `Anglesite-*` DerivedData glob.
- Logs are sacred: never drop subprocess output.
- Full-suite `swift test` output goes to a file (`/tmp` scratchpad), never `| tail`.

---

### Task 1: `WorkersDevStatusCenter` + state types (Core)

**Files:**
- Create: `Sources/AnglesiteCore/WorkersDevStatusCenter.swift`
- Test: `Tests/AnglesiteCoreTests/WorkersDevStatusCenterTests.swift`

**Interfaces:**
- Produces (used by Tasks 2–5):
  - `WorkersDevProcessState` — `.running` / `.restarting(attempt: Int)` / `.stopped` / `.failed(reason: String)`
  - `WorkersDevStatus` — `.starting` / `.running(url: URL?)` / `.restarting(attempt: Int)` / `.failed(reason: String)`
  - `WorkersDevSession { siteID, displayName, status }`, `Identifiable` by `siteID`
  - `WorkersDevStatusCenter` actor: `static let shared`, `update(siteID:displayName:status:)`, `remove(siteID:)`, `snapshot() -> [WorkersDevSession]`, `subscribe() -> Subscription` (stream of full `[WorkersDevSession]`, current snapshot replayed as first element)

- [ ] **Step 1: Write the failing tests**

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("WorkersDevStatusCenter")
struct WorkersDevStatusCenterTests {
    @Test("update then snapshot round-trips a session")
    func updateSnapshotRoundTrip() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        let sessions = await center.snapshot()
        #expect(sessions == [WorkersDevSession(siteID: "s1", displayName: "My Site", status: .starting)])
    }

    @Test("latest update per site wins")
    func latestUpdateWins() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        let url = URL(string: "http://127.0.0.1:51003")!
        await center.update(siteID: "s1", displayName: "My Site", status: .running(url: url))
        #expect(await center.snapshot() == [
            WorkersDevSession(siteID: "s1", displayName: "My Site", status: .running(url: url))
        ])
    }

    @Test("remove drops the session; removing an absent site is a no-op")
    func removeDropsSession() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        await center.remove(siteID: "s1")
        #expect(await center.snapshot().isEmpty)
        await center.remove(siteID: "never-added")  // must not crash or broadcast
        #expect(await center.snapshot().isEmpty)
    }

    @Test("snapshot is sorted by displayName then siteID for stable UI order")
    func snapshotSorted() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "b", displayName: "Zeta", status: .starting)
        await center.update(siteID: "a", displayName: "Alpha", status: .starting)
        #expect(await center.snapshot().map(\.siteID) == ["a", "b"])
    }

    @Test("subscribe replays the current snapshot, then streams each change")
    func subscribeReplaysThenStreams() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        let subscription = await center.subscribe()
        var iterator = subscription.stream.makeAsyncIterator()
        let first = await iterator.next()
        #expect(first == [WorkersDevSession(siteID: "s1", displayName: "My Site", status: .starting)])
        await center.remove(siteID: "s1")
        let second = await iterator.next()
        #expect(second == [])
        subscription.cancel()
    }

    @Test("cancel unregisters the subscriber")
    func cancelUnregisters() async throws {
        let center = WorkersDevStatusCenter()
        let subscription = await center.subscribe()
        subscription.cancel()
        // onTermination unregisters via a Task hop; poll briefly (a bounded poll on an async
        // unregistration, mirroring LogCenter's own tests).
        for _ in 0..<50 {
            if await center.subscriberCount() == 0 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(await center.subscriberCount() == 0)
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `swift test --package-path . --filter WorkersDevStatusCenterTests 2>&1 | head -40`
Expected: FAIL to compile — `WorkersDevStatusCenter` not defined.

- [ ] **Step 3: Implement**

`Sources/AnglesiteCore/WorkersDevStatusCenter.swift`:

```swift
import Foundation

/// AnglesiteCore-visible mirror of the container layer's internal `GuestProcessSupervisor.State`
/// (#699) — what a `LocalContainerControl.startWorkersDev(…onState:)` callback delivers. Kept
/// separate from `WorkersDevStatus` below because the supervisor doesn't know the proxied URL;
/// `LocalContainerSiteRuntime` composes the two.
public enum WorkersDevProcessState: Sendable, Equatable {
    case running
    case restarting(attempt: Int)
    case stopped
    case failed(reason: String)
}

/// One site's local wrangler-dev session status as shown in the Debug Pane (#699).
public enum WorkersDevStatus: Sendable, Equatable {
    case starting
    /// `url` is nil only in the brief window between the supervisor reporting `.running` and
    /// `startWorkersDev` returning the proxied URL.
    case running(url: URL?)
    case restarting(attempt: Int)
    case failed(reason: String)
}

public struct WorkersDevSession: Sendable, Equatable, Identifiable {
    public var id: String { siteID }
    public let siteID: String
    public let displayName: String
    public let status: WorkersDevStatus

    public init(siteID: String, displayName: String, status: WorkersDevStatus) {
        self.siteID = siteID
        self.displayName = displayName
        self.status = status
    }
}

/// Central fan-out for local wrangler-dev session status, mirroring `LogCenter`'s shape: per-site
/// runtimes publish, the (app-global) Debug Pane subscribes. Latest state per site; a removed
/// site's row disappears. Subscribers receive the full ordered snapshot on every change — the
/// population is "open site windows with active workers" (single digits), so full snapshots keep
/// the SwiftUI side a dumb ForEach.
public actor WorkersDevStatusCenter {
    /// Shared instance used by production wiring. Tests build their own.
    public static let shared = WorkersDevStatusCenter()

    /// Handle returned by `subscribe()` — same contract as `LogCenter.Subscription`: `cancel()`
    /// finishes the continuation so a `for await` consumer unblocks.
    public struct Subscription: Sendable {
        public let stream: AsyncStream<[WorkersDevSession]>
        private let continuation: AsyncStream<[WorkersDevSession]>.Continuation

        init(stream: AsyncStream<[WorkersDevSession]>, continuation: AsyncStream<[WorkersDevSession]>.Continuation) {
            self.stream = stream
            self.continuation = continuation
        }

        public func cancel() {
            continuation.finish()
        }
    }

    private var sessions: [String: WorkersDevSession] = [:]
    private var subscribers: [UUID: AsyncStream<[WorkersDevSession]>.Continuation] = [:]

    public init() {}

    public func update(siteID: String, displayName: String, status: WorkersDevStatus) {
        sessions[siteID] = WorkersDevSession(siteID: siteID, displayName: displayName, status: status)
        broadcast()
    }

    public func remove(siteID: String) {
        guard sessions.removeValue(forKey: siteID) != nil else { return }
        broadcast()
    }

    /// Current sessions, sorted by display name (then siteID) for a stable row order.
    public func snapshot() -> [WorkersDevSession] {
        sessions.values.sorted {
            ($0.displayName, $0.siteID) < ($1.displayName, $1.siteID)
        }
    }

    /// Subscribes to session changes. The current snapshot is replayed as the first element, so a
    /// Debug Pane opened mid-session shows existing rows without a separate `snapshot()` call.
    public func subscribe() -> Subscription {
        let (stream, continuation) = AsyncStream<[WorkersDevSession]>.makeStream(bufferingPolicy: .unbounded)
        let id = UUID()
        subscribers[id] = continuation
        continuation.yield(snapshot())
        continuation.onTermination = { [weak self] _ in
            guard let self else { return }
            Task { await self.removeSubscriber(id) }
        }
        return Subscription(stream: stream, continuation: continuation)
    }

    /// Number of live subscribers. Exposed for tests; not part of the public contract.
    public func subscriberCount() -> Int {
        subscribers.count
    }

    private func broadcast() {
        let ordered = snapshot()
        for continuation in subscribers.values {
            continuation.yield(ordered)
        }
    }

    private func removeSubscriber(_ id: UUID) {
        subscribers[id] = nil
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `swift test --package-path . --filter WorkersDevStatusCenterTests 2>&1 | tail -20`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkersDevStatusCenter.swift Tests/AnglesiteCoreTests/WorkersDevStatusCenterTests.swift
git commit -m "feat(#699): WorkersDevStatusCenter for local worker status"
```

---

### Task 2: `LocalContainerControl.startWorkersDev(…onState:)` requirement with default

**Files:**
- Modify: `Sources/AnglesiteCore/LocalContainerControl.swift` (after the existing 3-param `startWorkersDev` requirement, and in the existing `extension LocalContainerControl` that defaults `resetNetworking`)
- Modify: `Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift` (the first actor, `FakeLocalContainerControl`, only — the gated fakes inherit the default)

**Interfaces:**
- Consumes: `WorkersDevProcessState` (Task 1).
- Produces: protocol requirement used by Task 3's runtime call and Task 4's real implementation:
  `func startWorkersDev(siteID: String, workers: [WorkerDescriptor], onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void, onState: @escaping @Sendable (WorkersDevProcessState) -> Void) async throws -> URL`
- Produces (test seam): `FakeLocalContainerControl.lastWorkersDevOnState` (captured callback) and `setStartWorkersDevResult(_:)` (actor-isolated setter — a bare `await control.startWorkersDevResult = …` doesn't compile, see the comment at `LocalContainerSiteRuntimeTests.swift:471`).

- [ ] **Step 1: Add the requirement + default (no test first — pure protocol surface; Task 3's tests cover behavior)**

In `LocalContainerControl.swift`, directly after the existing 3-param `startWorkersDev` requirement:

```swift
    /// Like `startWorkersDev(siteID:workers:onOutput:)`, but also surfaces the supervised guest
    /// process's lifecycle transitions (#699) as `WorkersDevProcessState` values, so UI-facing
    /// callers can render a live status indicator without importing the container layer.
    /// Conformers with no live process state to report (test fakes, the Linux/podman control,
    /// which throws unsupported anyway) inherit the default below, which ignores `onState` —
    /// the same defaulted-requirement pattern `resetNetworking` already uses.
    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
        onState: @escaping @Sendable (WorkersDevProcessState) -> Void
    ) async throws -> URL
```

In the existing `extension LocalContainerControl` (alongside the `resetNetworking` default):

```swift
    public func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
        onState: @escaping @Sendable (WorkersDevProcessState) -> Void
    ) async throws -> URL {
        try await startWorkersDev(siteID: siteID, workers: workers, onOutput: onOutput)
    }
```

- [ ] **Step 2: Extend `FakeLocalContainerControl`**

Add below the existing `stopWorkersDevCalls` property:

```swift
    /// The `onState` callback captured from the most recent 4-param `startWorkersDev` call —
    /// tests invoke it directly to simulate supervisor transitions (crash-restart, failure).
    private(set) var lastWorkersDevOnState: (@Sendable (WorkersDevProcessState) -> Void)?

    /// Actor-isolated setter: `startWorkersDevResult` can't be assigned from outside the actor.
    func setStartWorkersDevResult(_ result: Result<URL, LocalContainerError>) {
        startWorkersDevResult = result
    }
```

Add below the existing 3-param `startWorkersDev` method:

```swift
    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
        onState: @escaping @Sendable (WorkersDevProcessState) -> Void
    ) async throws -> URL {
        lastWorkersDevOnState = onState
        return try await startWorkersDev(siteID: siteID, workers: workers, onOutput: onOutput)
    }
```

- [ ] **Step 3: Verify everything still compiles and the suite is green**

Run: `swift build --package-path . --build-tests 2>&1 | tail -5` then `swift test --package-path . --filter LocalContainerSiteRuntimeTests 2>&1 | tail -10`
Expected: build succeeds (all 15 conformers satisfied via the default); existing runtime tests PASS.

- [ ] **Step 4: Confirm no conformer was missed** (platform-gated conformers are invisible to a macOS build)

Run: `grep -rn ": LocalContainerControl" Sources Tests --include="*.swift"`
Expected: the same 15 known conformers; none newly broken (`swift build` above is the arbiter for macOS; Linux CI covers `PodmanContainerControl`, which needs no change).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/LocalContainerControl.swift Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift
git commit -m "feat(#699): defaulted onState variant of startWorkersDev"
```

---

### Task 3: Runtime publishes status + `worker:<siteID>` log source

**Files:**
- Modify: `Sources/AnglesiteCore/LocalContainerSiteRuntime.swift` — init (~line 48), `startWorkersDevIfActive` (~line 141), `updateActiveWorkers` (~line 178), `teardown()` (~line 453)
- Test: `Tests/AnglesiteCoreTests/LocalContainerSiteRuntimeTests.swift` (extend the existing `// MARK: - Workers-dev worker-awareness (#708)` section)

**Interfaces:**
- Consumes: `WorkersDevStatusCenter` / `WorkersDevStatus` / `WorkersDevProcessState` (Task 1), the 4-param `startWorkersDev` + fake seams (Task 2).
- Produces: `LocalContainerSiteRuntime.init` gains `statusCenter: WorkersDevStatusCenter = .shared`; wrangler-dev output now lands under `worker:<siteID>` (Task 5's UI note; `StartupProgressModel` is unaffected — it filters `container:<siteID>` for boot estimation, and worker lines were noise there, per spec §3).

- [ ] **Step 1: Write the failing tests** (append to the `#708` MARK section; fixtures mirror `startsWorkersDevWhenActiveSetNonEmpty` exactly)

```swift
    @Test("workers-dev success publishes .running(url:) and logs under worker:<siteID> (#699)")
    func workersDevPublishesRunningAndWorkerSource() async throws {
        let control = FakeLocalContainerControl(startResult: .success(Self.ok))
        await control.setStartWorkersDevStdoutLines(["Ready on http://localhost:8787"])
        let statusCenter = WorkersDevStatusCenter()
        let logCenter = LogCenter()
        let package = try temporaryPackage()
        let configStore = SiteConfigStore(configDirectory: AnglesitePackage(url: package).configURL)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))
        let rt = LocalContainerSiteRuntime(
            ref: "HEAD", control: control, mcpClient: MCPClient(supervisor: .shared),
            logCenter: logCenter,
            connect: { _, _ in },
            workerCatalog: { [WorkerDescriptor(
                id: "indieauth", displayName: "IndieAuth", description: "d", group: "identity",
                binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false))] },
            statusCenter: statusCenter)

        await rt.start(siteID: "s1", siteDirectory: AnglesitePackage(url: package).sourceURL)

        // temporaryPackage() writes no Info.plist marker, so displayName falls back to siteID.
        #expect(await statusCenter.snapshot() == [WorkersDevSession(
            siteID: "s1", displayName: "s1",
            status: .running(url: URL(string: "http://127.0.0.1:51003")!))])
        // The fake replays its onOutput lines synchronously inside startWorkersDev, but the
        // runtime's sink hops through a Task per line — poll briefly for arrival.
        var workerLines: [LogCenter.LogLine] = []
        for _ in 0..<50 {
            workerLines = await logCenter.snapshot().filter { $0.source == "worker:s1" }
            if !workerLines.isEmpty { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(workerLines.map(\.text) == ["Ready on http://localhost:8787"])
    }

    @Test("workers-dev start failure publishes .failed (#699)")
    func workersDevFailurePublishesFailed() async throws {
        let control = FakeLocalContainerControl(startResult: .success(Self.ok))
        await control.setStartWorkersDevResult(.failure(.bootFailed("no wrangler in image")))
        let statusCenter = WorkersDevStatusCenter()
        let package = try temporaryPackage()
        let configStore = SiteConfigStore(configDirectory: AnglesitePackage(url: package).configURL)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))
        let rt = LocalContainerSiteRuntime(
            ref: "HEAD", control: control, mcpClient: MCPClient(supervisor: .shared),
            connect: { _, _ in },
            workerCatalog: { [WorkerDescriptor(
                id: "indieauth", displayName: "IndieAuth", description: "d", group: "identity",
                binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false))] },
            statusCenter: statusCenter)

        await rt.start(siteID: "s1", siteDirectory: AnglesitePackage(url: package).sourceURL)

        let sessions = await statusCenter.snapshot()
        #expect(sessions.count == 1)
        guard case .failed(let reason)? = sessions.first?.status else {
            Issue.record("expected .failed, got \(String(describing: sessions.first?.status))")
            return
        }
        #expect(reason.contains("no wrangler in image"))
    }

    @Test("supervisor transitions via onState re-publish, and .stopped removes the row (#699)")
    func workersDevOnStateTransitions() async throws {
        let control = FakeLocalContainerControl(startResult: .success(Self.ok))
        let statusCenter = WorkersDevStatusCenter()
        let package = try temporaryPackage()
        let configStore = SiteConfigStore(configDirectory: AnglesitePackage(url: package).configURL)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))
        let rt = LocalContainerSiteRuntime(
            ref: "HEAD", control: control, mcpClient: MCPClient(supervisor: .shared),
            connect: { _, _ in },
            workerCatalog: { [WorkerDescriptor(
                id: "indieauth", displayName: "IndieAuth", description: "d", group: "identity",
                binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false))] },
            statusCenter: statusCenter)
        await rt.start(siteID: "s1", siteDirectory: AnglesitePackage(url: package).sourceURL)
        let onState = try #require(await control.lastWorkersDevOnState)

        onState(.restarting(attempt: 1))
        var status = await pollStatus(statusCenter, siteID: "s1") { if case .restarting = $0 { true } else { false } }
        #expect(status == .restarting(attempt: 1))

        onState(.running)
        status = await pollStatus(statusCenter, siteID: "s1") { if case .running(.some) = $0 { true } else { false } }
        // A post-restart .running re-attaches the URL the runtime learned at start.
        #expect(status == .running(url: URL(string: "http://127.0.0.1:51003")!))

        onState(.stopped)
        for _ in 0..<50 {
            if await statusCenter.snapshot().isEmpty { break }
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(await statusCenter.snapshot().isEmpty)
    }

    /// Polls until `siteID`'s status satisfies `predicate` (the runtime publishes via detached
    /// Tasks, so arrival is async), returning the matched status or the last seen one on timeout.
    private func pollStatus(
        _ center: WorkersDevStatusCenter, siteID: String,
        until predicate: (WorkersDevStatus) -> Bool
    ) async -> WorkersDevStatus? {
        var last: WorkersDevStatus?
        for _ in 0..<50 {
            last = await center.snapshot().first { $0.siteID == siteID }?.status
            if let last, predicate(last) { return last }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return last
    }

    @Test("runtime stop() removes the status row (#699)")
    func workersDevStopRemovesRow() async throws {
        let control = FakeLocalContainerControl(startResult: .success(Self.ok))
        let statusCenter = WorkersDevStatusCenter()
        let package = try temporaryPackage()
        let configStore = SiteConfigStore(configDirectory: AnglesitePackage(url: package).configURL)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))
        let rt = LocalContainerSiteRuntime(
            ref: "HEAD", control: control, mcpClient: MCPClient(supervisor: .shared),
            connect: { _, _ in },
            workerCatalog: { [WorkerDescriptor(
                id: "indieauth", displayName: "IndieAuth", description: "d", group: "identity",
                binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false))] },
            statusCenter: statusCenter)
        await rt.start(siteID: "s1", siteDirectory: AnglesitePackage(url: package).sourceURL)
        #expect(await !statusCenter.snapshot().isEmpty)

        await rt.stop()
        #expect(await statusCenter.snapshot().isEmpty)
    }

    @Test("updateActiveWorkers with an empty effective set stops and removes the row (#699)")
    func updateActiveWorkersEmptySetRemovesRow() async throws {
        let control = FakeLocalContainerControl(startResult: .success(Self.ok))
        let statusCenter = WorkersDevStatusCenter()
        let package = try temporaryPackage()
        let configStore = SiteConfigStore(configDirectory: AnglesitePackage(url: package).configURL)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))
        let rt = LocalContainerSiteRuntime(
            ref: "HEAD", control: control, mcpClient: MCPClient(supervisor: .shared),
            connect: { _, _ in },
            workerCatalog: { [WorkerDescriptor(
                id: "indieauth", displayName: "IndieAuth", description: "d", group: "identity",
                binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false))] },
            statusCenter: statusCenter)
        await rt.start(siteID: "s1", siteDirectory: AnglesitePackage(url: package).sourceURL)

        await rt.updateActiveWorkers(SiteSettings())  // no activeWorkerIDs → empty effective set

        #expect(await control.stopWorkersDevCalls == ["s1"])
        #expect(await statusCenter.snapshot().isEmpty)
    }
```

Note: `setStartWorkersDevStdoutLines` needs the same actor-isolated-setter treatment as
`setStartWorkersDevResult` — add to `FakeLocalContainerControl` in this task:

```swift
    func setStartWorkersDevStdoutLines(_ lines: [String]) {
        startWorkersDevStdoutLines = lines
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `swift test --package-path . --filter LocalContainerSiteRuntimeTests 2>&1 | tail -20`
Expected: FAIL to compile — no `statusCenter:` init parameter.

- [ ] **Step 3: Implement the runtime changes**

(a) Stored property + init parameter (after `workerCatalog` in both, keeping keyword-arg source compatibility):

```swift
    private let statusCenter: WorkersDevStatusCenter
    /// Local wrangler-dev URLs learned per site — lets a supervisor-driven post-restart
    /// `.running` re-attach the URL `startWorkersDev` returned (#699).
    private var workersDevURLs: [String: URL] = [:]
```

init parameter `statusCenter: WorkersDevStatusCenter = .shared` (last parameter), assigned in the body.

(b) Replace `startWorkersDevIfActive`'s body — the `source` line changes to `worker:`, and publishing brackets the control call. Keep the existing doc comment, appending one sentence: `/// Status transitions are published to `statusCenter` under the package's display name (#699).`

```swift
    private func startWorkersDevIfActive(siteID: String, siteDirectory: URL) async -> URL? {
        let packageURL = AnglesitePackage.packageRoot(fromSourceURL: siteDirectory)
        let configDirectory = AnglesitePackage(url: packageURL).configURL
        let settings = (try? await SiteConfigStore(configDirectory: configDirectory).load()) ?? SiteSettings()
        let catalog = await workerCatalog()
        let effectiveActiveIDs = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: catalog, graph: nil)
        let workers = WorkerActivation.activeDescriptors(catalog: catalog, activeIDs: effectiveActiveIDs)
        guard !workers.isEmpty else { return nil }
        let logCenter = self.logCenter
        let statusCenter = self.statusCenter
        let source = "worker:\(siteID)"
        let displayName = (try? AnglesitePackage(url: packageURL).readMarker().displayName) ?? siteID
        await statusCenter.update(siteID: siteID, displayName: displayName, status: .starting)
        do {
            let url = try await control.startWorkersDev(
                siteID: siteID, workers: workers,
                onOutput: { line, stream in
                    Task { await logCenter.append(source: source, stream: stream, text: line) }
                },
                onState: { [weak self] state in
                    Task { await self?.handleWorkersDevState(state, siteID: siteID, displayName: displayName) }
                })
            workersDevURLs[siteID] = url
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .running(url: url))
            return url
        } catch {
            await logCenter.append(
                source: source, stream: .stderr,
                text: "local wrangler-dev failed to start: \(error) — active workers will have no local dev endpoint this session")
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .failed(reason: "\(error)"))
            return nil
        }
    }

    /// Maps supervisor-driven transitions (#699) into `statusCenter` rows. `.running` re-attaches
    /// the URL learned at `startWorkersDev`-return time (nil in the brief pre-return window);
    /// `.stopped` removes the row — an intentional stop isn't an error state worth a lingering row.
    /// Captured `siteID`/`displayName` (not `activeSiteID`) keep late supervisor events attributed
    /// to the session that produced them, mirroring `startWorkersDevIfActive`'s log-source capture.
    private func handleWorkersDevState(_ state: WorkersDevProcessState, siteID: String, displayName: String) async {
        switch state {
        case .running:
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .running(url: workersDevURLs[siteID]))
        case .restarting(let attempt):
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .restarting(attempt: attempt))
        case .failed(let reason):
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .failed(reason: reason))
        case .stopped:
            await statusCenter.remove(siteID: siteID)
        }
    }
```

The existing doc comment above `startWorkersDevIfActive` explains why `logCenter`/`source` are
captured locally rather than read from `self` — the `[weak self]` in `onState` is fine because
`handleWorkersDevState` uses only the *captured* `siteID`/`displayName` (attribution can't drift);
`self` is needed solely for the URL map and center.

(c) `updateActiveWorkers` — in the `workers.isEmpty` branch, directly after the existing `try? await control.stopWorkersDev(siteID: siteID)`:

```swift
            workersDevURLs[siteID] = nil
            await statusCenter.remove(siteID: siteID)
```

(d) `teardown()` — inside the existing `if let id = containerSiteID` block, after `try? await control.stop(siteID: id)`:

```swift
            // Explicit, not just supervisor-event-driven: the fake controls in tests never emit
            // .stopped, and a real teardown must never leave a stale row either way (#699).
            workersDevURLs[id] = nil
            await statusCenter.remove(siteID: id)
```

- [ ] **Step 4: Run to verify pass**

Run: `swift test --package-path . --filter LocalContainerSiteRuntimeTests 2>&1 | tail -20`
Expected: all PASS, including the pre-existing #708 cases (whose `container:` assertions don't exist — they assert URLs/calls, not sources).

- [ ] **Step 5: Also run the neighboring suites that share the fakes**

Run: `swift test --package-path . --filter "ContainerDeployExecutorTests|ContainerCommandRunnerTests|ContainerAuditExecutorTests|DeployExecutorSelectionTests" 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/LocalContainerSiteRuntime.swift Tests/AnglesiteCoreTests/LocalContainerSiteRuntimeTests.swift Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift
git commit -m "feat(#699): publish worker status; worker:<siteID> log source"
```

---

### Task 4: `ContainerizationControl` forwards supervisor state

**Files:**
- Modify: `Sources/AnglesiteContainer/ContainerizationControl.swift` — `startWorkersDev` (~line 210), `LiveContainers` (~line 1140)
- Modify: `Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift` — `startsWorkersDevForActiveWorker` (~line 69)

**Interfaces:**
- Consumes: `WorkersDevProcessState` (Task 1), the 4-param protocol requirement (Task 2), `GuestProcessSupervisor.observe()` (existing — replays current state on subscribe; `superviseLoop` returns after terminal `.stopped`/`.failed`).
- Produces: the real 4-param `startWorkersDev`; the 3-param entry point remains as a forwarder (probe + e2e-boot callers unchanged).

- [ ] **Step 1: Change the real implementation's signature and add the forwarder**

The existing `public func startWorkersDev(siteID:workers:onOutput:)` gains the `onState` parameter (doc comment: append `/// - Parameter onState: Receives supervisor lifecycle transitions (#699); see LocalContainerControl.`). Directly above it, add:

```swift
    /// Three-parameter entry point retained for callers that don't observe process state (the
    /// container probe, the e2e boot test) — protocol conformance for both requirements.
    public func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        try await startWorkersDev(siteID: siteID, workers: workers, onOutput: onOutput, onState: { _ in })
    }
```

In the 4-param body, directly after `try await supervisor.start()`:

```swift
        // Forward supervisor transitions to the caller (#699). observe() replays the current
        // state on subscribe, so the initial `.running` is never missed. The loop self-terminates
        // on the supervisor's terminal states (superviseLoop returns after `.stopped`/`.failed`,
        // and stop() emits `.stopped`), so this task ends with the session; teardownWorkersDev's
        // cancel below is only a backstop.
        let stateTask = Task {
            for await state in await supervisor.observe() {
                switch state {
                case .running: onState(.running)
                case .restarting(let attempt): onState(.restarting(attempt: attempt))
                case .stopped: onState(.stopped); return
                case .failed(let reason): onState(.failed(reason: reason)); return
                }
            }
        }
```

And the final bookkeeping line changes from
`await live.storeWorkersDev(siteID: siteID, supervisor: supervisor, bridge: bridgeHandle, proxy: proxy)` to:

```swift
        await live.storeWorkersDev(
            siteID: siteID, supervisor: supervisor, bridge: bridgeHandle, proxy: proxy, stateTask: stateTask)
```

(The two failure `catch`es between `supervisor.start()` and `storeWorkersDev` call
`await supervisor.stop()`, which emits `.stopped` — the state task forwards it and self-ends, so
those paths need no explicit cancel.)

- [ ] **Step 2: Track the task in `LiveContainers`**

```swift
    private var workersDevStateTasks: [String: Task<Void, Never>] = [:]
```

`storeWorkersDev` gains the parameter and stores it:

```swift
    func storeWorkersDev(
        siteID: String, supervisor: GuestProcessSupervisor, bridge: InteractiveExecHandle,
        proxy: VsockTCPProxy, stateTask: Task<Void, Never>
    ) {
        workersDevSupervisors[siteID] = supervisor
        workersDevBridges[siteID] = bridge
        workersDevProxies[siteID] = proxy
        workersDevStateTasks[siteID] = stateTask
    }
```

`teardownWorkersDev` — after the `supervisor.stop()` line (which emits the `.stopped` the task exits on):

```swift
        workersDevStateTasks[siteID]?.cancel()
        workersDevStateTasks[siteID] = nil
```

- [ ] **Step 3: Extend the e2e test** (`startsWorkersDevForActiveWorker`): replace the `startWorkersDev` call with the 4-param form collecting states:

```swift
        let collector = StateCollector()
        let workersDevURL = try await control.startWorkersDev(
            siteID: siteID, workers: workers,
            onOutput: { _, _ in },
            onState: { state in Task { await collector.append(state) } })
```

and after the existing `#expect(ok, …)` line:

```swift
        // observe() replays the current state on subscribe, so `.running` must have been
        // delivered by the time the endpoint answers HTTP (#699).
        var states = await collector.states
        for _ in 0..<50 where states.isEmpty {
            try? await Task.sleep(for: .milliseconds(100))
            states = await collector.states
        }
        #expect(states.first == .running)
```

with this helper actor added at file scope (bottom of the file):

```swift
private actor StateCollector {
    private(set) var states: [WorkersDevProcessState] = []
    func append(_ state: WorkersDevProcessState) { states.append(state) }
}
```

(`WorkersDevProcessState` comes via the file's existing `import AnglesiteCore` — check the imports; add it if the file only imports `AnglesiteContainer`.)

- [ ] **Step 4: Verify — compile-level for the entitled-only e2e, full build for the rest**

Run: `swift build --package-path . --build-tests 2>&1 | tail -5`
Expected: builds clean (the e2e suite compiles; running it stays gated on `ANGLESITE_CONTAINER_TESTS=1`, which CI/`swift test` skip — per CLAUDE.md, only `scripts/run-container-probe.sh` on entitled hardware truly executes this path).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteContainer/ContainerizationControl.swift Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift
git commit -m "feat(#699): forward wrangler-dev supervisor state via onState"
```

---

### Task 5: Debug Pane "Local Workers" rows

**Files:**
- Modify: `Sources/AnglesiteApp/DebugPaneView.swift` — init (~line 25), `serverSection` (~line 112), `startStreaming` area (~line 155), `body`'s `.task`/`.onDisappear` (~lines 61–62)

**Interfaces:**
- Consumes: `WorkersDevStatusCenter.subscribe()`/`WorkersDevSession`/`WorkersDevStatus` (Task 1).
- Produces: user-visible UI only.

- [ ] **Step 1: Implement** (no unit test — `PlistEditorView`-style pure SwiftUI gets a manual-smoke follow-up per repo convention, filed in Task 6)

State + init (`center` parameter pattern extended):

```swift
    @State private var workerSessions: [WorkersDevSession] = []
    @State private var workersSubscriberTask: Task<Void, Never>?
    private let workersCenter: WorkersDevStatusCenter

    init(center: LogCenter = .shared, workersCenter: WorkersDevStatusCenter = .shared) {
        self.center = center
        self.workersCenter = workersCenter
    }
```

`body` modifiers change to:

```swift
        .task { await startStreaming() }
        .task { await streamWorkerSessions() }
        .onDisappear {
            subscriberTask?.cancel()
            workersSubscriberTask?.cancel()
        }
```

`serverSection` becomes a `VStack` wrapping the existing ESI `HStack` plus the new rows (existing ESI row content unchanged):

```swift
    /// Production-behavior controls, distinct from the log-filtering toolbar above. ESI's
    /// Live/Unprocessed toggle is the first control here (see
    /// docs/superpowers/specs/2026-07-13-esi-astro-component-design.md §4a); the Local Workers
    /// rows surface each open site's wrangler-dev session (#699,
    /// docs/superpowers/specs/2026-07-30-server-debug-panel-design.md §5).
    private var serverSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text("Server").font(.headline)
                Picker("ESI Fragments", selection: $esiPreviewMode.unprocessed) {
                    Text("Live").tag(false)
                    Text("Unprocessed (show fallbacks)").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 320)
                Spacer()
            }
            ForEach(workerSessions) { session in
                workerRow(session)
            }
        }
    }

    private func workerRow(_ session: WorkersDevSession) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle()
                .fill(statusColor(session.status))
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)  // the status text carries the meaning
            Text(session.displayName)
                .font(.system(size: 12, weight: .medium))
            statusText(session.status)
                .font(.system(size: 12))
            if case .running(.some(let url)) = session.status {
                Link(url.absoluteString, destination: url)
                    .font(.system(size: 12, design: .monospaced))
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(url.absoluteString, forType: .string)
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .help("Copy local worker URL")
                .accessibilityLabel("Copy local worker URL")
            }
            if case .failed(let reason) = session.status {
                Text(reason)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(reason)
            }
            Spacer()
        }
        .padding(.leading, 4)
    }

    private func statusColor(_ status: WorkersDevStatus) -> Color {
        switch status {
        case .starting: return .secondary.opacity(0.5)
        case .running: return .green
        case .restarting: return .orange
        case .failed: return .red
        }
    }

    private func statusText(_ status: WorkersDevStatus) -> Text {
        switch status {
        case .starting: return Text("Starting…").foregroundStyle(.secondary)
        case .running: return Text("Running").foregroundStyle(.secondary)
        case .restarting(let attempt): return Text("Restarting (attempt \(attempt))").foregroundStyle(.orange)
        case .failed: return Text("Failed").foregroundStyle(.red)
        }
    }

    private func streamWorkerSessions() async {
        // subscribe() replays the current snapshot as its first element, so a pane opened
        // mid-session shows existing rows immediately.
        let subscription = await workersCenter.subscribe()
        let task = Task { @MainActor in
            for await sessions in subscription.stream {
                if Task.isCancelled { break }
                workerSessions = sessions
            }
        }
        workersSubscriberTask = task
        _ = await task.value
    }
```

Note: `Color.secondary` doesn't exist as a `ShapeStyle`-to-`Color` conversion — use
`Color(NSColor.secondaryLabelColor).opacity(0.5)` for the `.starting` dot if the compiler
rejects `.secondary.opacity(0.5)` in `Color` position (the `statusColor` return type is `Color`).

- [ ] **Step 2: Build the package targets first for fast feedback**

Run: `swift build --package-path . 2>&1 | tail -5`
Expected: `DebugPaneView` isn't in a SwiftPM target (app target only) — this checks Core still builds; the real gate is the next step.

- [ ] **Step 3: Build the app** (regenerates the project first)

```bash
xcodegen generate
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -15
```
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: String Catalog sync** (new literals: "Starting…", "Running", "Restarting (attempt %lld)", "Failed", "Copy local worker URL") — scoped to THIS worktree's BUILD_DIR per CONTRIBUTING.md:

```bash
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
git diff --stat Sources/AnglesiteApp/Localizable.xcstrings
```
Review the diff: ONLY keys this task added may appear as additions. If unrelated keys appear, discard and re-run scoped correctly.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/DebugPaneView.swift Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "feat(#699): Local Workers status rows in the Debug Pane"
```

---

### Task 6: Full verification, follow-up issues, PR

- [ ] **Step 1: Full test suite to a file**

```bash
swift test --package-path . > /tmp/anglesite-699-swift-test.log 2>&1; echo "exit: $?"; grep -E "Test run|failed|passed" /tmp/anglesite-699-swift-test.log | tail -5
```
Expected: exit 0. (Known flakes per memory: FM token-overflow in Generable tests, AstroDevServer port flake — re-run once before debugging.)

- [ ] **Step 2: Rebuild the app** (proves the .app links after all changes)

```bash
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -5
```

- [ ] **Step 3: File the two follow-up issues** (spec §6)

1. "In-app analytics data viewing (Web Analytics / RUM)" — body: supersedes #699's third scope bullet; starting point `CloudflareWebAnalyticsClient` (host→siteTag only today); needs the Cloudflare GraphQL Analytics API + token-gated fetch + UI; dashboard deep-links (#710, `WorkerDashboardLinks`) remain the interim answer. Label: `🎯 Deployment`.
2. "Manual GUI smoke: Debug Pane Local Workers rows (#699)" — body: open a site with an active worker; verify the row appears with Running + URL, the link opens, Copy copies; toggle the worker off in Site Settings ▸ Workers and verify the row disappears; kill wrangler in the guest and verify Restarting/Failed rendering. Label: `✅ Manual QA`.

- [ ] **Step 4: PR** — re-read `CONTRIBUTING.md` ▸ "Commits and pull requests" and `.github/PULL_REQUEST_TEMPLATE.md` first; body uses the template's exact headings (**Summary**, **Paired PR check**, **Test plan**). Paired PR check: none needed — no MCP schema change, no template change, no catalog schema change. Push `claude/issue-699-3fe4a8`, open PR against `main`, then `gh issue edit 699 --remove-label "🛠️ In Progress"`.
