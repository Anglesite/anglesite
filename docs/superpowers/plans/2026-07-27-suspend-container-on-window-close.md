# Suspend Container Instead of Shutdown on Window Close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a site window closes, pause the site's Apple-Containerization VM (freezing astro/mcp/the guest processes in memory) instead of fully tearing it down, so reopening the same site moments later resumes in seconds instead of paying the ~186–300s cold-boot cost again.

**Architecture:** Apple's Virtualization.framework (reached through the vendored `Containerization` package's `VirtualMachineInstance.pause()`/`.resume()`, via `LinuxContainer.withVirtualMachineInstance`) already supports pausing a running VM in place. Anglesite's own `LocalContainerControl`/`LiveContainers`/`LocalContainerSiteRuntime` stack currently only knows "boot" and "fully tear down" — this plan adds a third state, "paused," held in a new process-wide `PausedContainerRegistry` (so it survives the window's own object graph being deallocated on close), and teaches `ContainerizationControl.start()` to resume from it before falling back to a cold boot.

**Tech Stack:** Swift 6.4, Apple Containerization (`Containerization`/`ContainerizationOCI`/`ContainerizationExtras`), Virtualization.framework (via the vendored package — no direct import), Swift Testing.

## Global Constraints

- Toolchain: Xcode 27+ / Swift 6.4, macOS 27+ deployment target (per `CLAUDE.md`).
- No frameworks beyond Apple's own; no new SwiftPM dependencies.
- `AnglesiteContainer` is app-only (never compiled by CI's `swift test`); real-VM behavior is verified via `ANGLESITE_CONTAINER_TESTS=1`-gated `AnglesiteContainerLocalTests` (each test body additionally gated on `ANGLESITE_CONTAINER_E2E=1`) and the entitled `anglesite-container-probe` executable run through `scripts/run-container-probe.sh` — neither runs in ordinary `swift test`.
- `AnglesiteCore` (where `LocalContainerControl`/`SiteRuntime` live) also builds on Linux — any protocol change must compile for `PodmanContainerControl` (`Sources/AnglesiteCore/Platform/PodmanContainerControl.swift`) and every existing test fake without forcing new conformances (see Task 2's default-extension approach).
- Commit subjects ≤72 characters; PR body follows `.github/PULL_REQUEST_TEMPLATE.md`'s actual headings (see `CONTRIBUTING.md`) — not a generic Summary/Test-plan shape.
- Before starting, open (or find) a tracking GitHub issue and claim it (`gh issue edit <n> --add-label "🛠️ In Progress"`) per `CLAUDE.md`'s issue-claiming workflow; no existing issue covers this as of 2026-07-27.
- Do all work in a git worktree (`.claude/worktrees/<name>/`), run `xcodegen generate` before the first build, and set `ANGLESITE_SIDECAR_SRC` to the real sibling checkout.

---

## Task 1: Spike — validate VZ pause/resume + vsock re-dial on real hardware

This is the decision gate for the whole plan: Apple's own vendored code carries an unresolved `// NOTE: Investigate what is the "right" way to handle already vended vsock connections for pause and resume` comment (`VZVirtualMachineInstance.swift:238`), and `VZVirtualMachineInstance.state` maps VZ's real `.paused`/`.pausing`/`.resuming` states to `.unknown` (`vzStateToInstanceState()`, `default: state = .unknown`) rather than a real case — meaning `stop()`'s own `guard self.state == .running` (`VZVirtualMachineInstance.swift:220`) will throw "vm is not running" if called on a still-paused VM. Every later task assumes: (a) a **fresh** `dialVsock` after `resume()` reaches the guest's still-alive listener, and (b) tearing down a paused entry requires **resuming it first**, then stopping. This task confirms both empirically before any production code is written.

**Files:**
- Modify: `Sources/AnglesiteContainerProbe/main.swift` (add a `pause-resume` subcommand, mirroring the existing `echo` subcommand)
- Modify: `scripts/run-container-probe.sh` (accept the new subcommand)

**Interfaces:**
- Consumes: `ContainerizationControl.makeBareContainer(siteID:sourceRepo:onOutput:)`, `.runDetached(...)`, `.stopBareContainer(...)` (all already `public`, used identically by `runEcho()`); `LinuxContainer.dialVsock(port:)`, `.withVirtualMachineInstance(_:)` (both already `public`); `VirtualMachineInstance.pause()`/`.resume()` (already declared on the protocol).
- Produces: an empirically-confirmed answer (recorded in this task's commit message / a short note) to "does suspend-then-resume work at the vsock layer at all" — every later task depends on this being yes. If the probe's post-resume round-trip fails, STOP and escalate to the user before continuing to Task 2 — the rest of this plan is not viable as designed.

- [ ] **Step 1: Add the `pause-resume` probe subcommand**

Edit `Sources/AnglesiteContainerProbe/main.swift`. Add the case to the dispatch switch:

```swift
        case "pause-resume":
            exitCode = await runPauseResume()
```

Add the function (place it near `runEcho()`, in the `// MARK: - echo` section or its own new section):

```swift
    // MARK: - pause-resume

    /// Decision gate for the suspend-on-window-close feature (docs/superpowers/plans/
    /// 2026-07-27-suspend-container-on-window-close.md): boot a bare container with a guest vsock
    /// echo listener, confirm a round trip, pause the VM, resume it, and confirm a FRESH dial still
    /// reaches the (never-restarted) guest listener. Also confirms the resume-before-stop ordering
    /// `PausedContainerRegistry.teardown` depends on: a VM must be resumed before `container.stop()`
    /// can succeed (a still-paused VM's `VirtualMachineInstanceState` reads `.unknown`, not
    /// `.running`, and `VZVirtualMachineInstance.stop()` guards on exactly that state).
    private static func runPauseResume() async -> Int32 {
        let siteID = "vsock-pause-resume-probe"
        let control = ContainerizationControl()

        let container: LinuxContainer
        do {
            container = try await control.makeBareContainer(siteID: siteID)
        } catch {
            print("GATE: FAIL — makeBareContainer threw: \(error)")
            return 1
        }

        func fail(_ message: String) async -> Int32 {
            print(message)
            await control.stopBareContainer(container, siteID: siteID)
            return 1
        }

        do {
            try await control.runDetached(
                container, id: "echo", label: "echo", onOutput: logLine,
                ["/usr/bin/socat", "VSOCK-LISTEN:9999,reuseaddr,fork", "EXEC:cat"])
        } catch {
            return await fail("GATE: FAIL — failed to launch guest socat echo listener: \(error)")
        }

        func roundTrip() async -> Bool {
            var handle: FileHandle?
            for _ in 0..<40 {
                if let h = try? await container.dialVsock(port: 9999) { handle = h; break }
                try? await Task.sleep(for: .milliseconds(250))
            }
            guard let fh = handle else { return false }
            let payload = Data("ping-vsock-echo\n".utf8)
            guard (try? fh.write(contentsOf: payload)) != nil else { return false }
            var received = Data()
            let deadline = ContinuousClock.now.advanced(by: .seconds(10))
            while received.count < payload.count, ContinuousClock.now < deadline {
                let chunk = fh.availableData
                if chunk.isEmpty { try? await Task.sleep(for: .milliseconds(100)) } else { received.append(chunk) }
            }
            try? fh.close()
            return received == payload
        }

        guard await roundTrip() else {
            return await fail("GATE: FAIL — pre-pause echo round-trip failed")
        }
        print("GATE: pre-pause round-trip OK")

        do {
            try await container.withVirtualMachineInstance { vm in try await vm.pause() }
        } catch {
            return await fail("GATE: FAIL — vm.pause() threw: \(error)")
        }
        print("GATE: pause() succeeded")

        do {
            try await container.withVirtualMachineInstance { vm in try await vm.resume() }
        } catch {
            return await fail("GATE: FAIL — vm.resume() threw: \(error)")
        }
        print("GATE: resume() succeeded")

        guard await roundTrip() else {
            return await fail(
                "GATE: FAIL — post-resume echo round-trip failed (fresh dial after resume) — vsock "
                + "connections/listeners may not survive pause/resume; suspend-on-close is not viable "
                + "as designed, escalate to the user before continuing this plan")
        }
        print("GATE: post-resume round-trip OK")

        // Resume-before-stop ordering: pause again (no resume this time) and confirm stopping a
        // still-paused container needs an explicit resume first — this is exactly what
        // `PausedContainerRegistry.teardown` (Task 2) and `ContainerizationControl`'s resume-failure
        // fallback (Task 5) must do.
        do {
            try await container.withVirtualMachineInstance { vm in try await vm.pause() }
        } catch {
            return await fail("GATE: FAIL — second vm.pause() threw: \(error)")
        }
        do {
            try await container.withVirtualMachineInstance { vm in try await vm.resume() }
        } catch {
            return await fail("GATE: FAIL — resume-before-stop's resume() threw: \(error)")
        }

        print("GATE: PASS")
        await control.stopBareContainer(container, siteID: siteID)
        return 0
    }
```

Also update the usage string in `main()`:

```swift
            FileHandle.standardError.write(Data("usage: anglesite-container-probe <echo|boot|workers-dev|pause-resume>\n".utf8))
```

and the `default:` branch's message similarly (`expected echo|boot|workers-dev|pause-resume`).

- [ ] **Step 2: Wire the subcommand into the probe runner script**

Edit `scripts/run-container-probe.sh`. Update the case-validation list:

```bash
case "${SUBCOMMAND}" in
    echo|boot|workers-dev|pause-resume) ;;
    *)
        echo "usage: $(basename "$0") <echo|boot|workers-dev|pause-resume>" >&2
        exit 2
        ;;
esac
```

- [ ] **Step 3: Build the probe**

Run: `swift build --package-path . --product anglesite-container-probe`
Expected: builds cleanly with no errors.

- [ ] **Step 4: Run the gate on entitled Apple-Silicon hardware**

Run: `scripts/run-container-probe.sh pause-resume`
Expected: `GATE: PASS` printed, exit code 0. If it prints any `GATE: FAIL` line, **stop here** — do not proceed to Task 2. Report the failure to the user; the suspend-on-close design in this plan assumes the vsock layer survives a pause/resume cycle when re-dialed fresh, and Tasks 4–6 need to be redesigned (or the feature abandoned) if it doesn't.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteContainerProbe/main.swift scripts/run-container-probe.sh
git commit -m "feat(container): add pause-resume probe gate for suspend-on-close"
```

---

## Task 2: `PausedContainerRegistry` — process-wide paused-container bookkeeping

Closing a site window deallocates its whole `SiteWindowModel` → `PreviewModel` → `LocalContainerSiteRuntime` → `ContainerizationControl` → `LiveContainers` object graph (`LiveSiteRuntimeFactory.makeRuntime` constructs a brand-new `ContainerizationControl()` — and therefore a brand-new `LiveContainers()` — every time a window opens, per `Sources/AnglesiteApp/LiveSiteRuntimeFactory.swift:34`). A paused container must be held somewhere that outlives that per-window graph, the same way `SharedVmnetNetwork.shared`/`RootfsTemplateCache.shared` already outlive it. This task adds that holder, with a capacity cap (each paused VM still reserves its full 2 vCPU/2GB — `ContainerizationControl.swift:445-446` — pausing freezes execution, it does not release guest memory) and LRU eviction.

**Files:**
- Create: `Sources/AnglesiteContainer/PausedContainerRegistry.swift`
- Test: `Tests/AnglesiteContainerLocalTests/PausedContainerRegistryTests.swift`

**Interfaces:**
- Consumes: `LinuxContainer` (Containerization), `SharedVmnetNetwork.shared.release(siteID:)` (existing, `Sources/AnglesiteContainer/ContainerizationControl.swift` — a process-shared actor already used the same way by `ContainerizationControl.stop`/`stopBareContainer`).
- Produces: `PausedContainerRegistry.shared` (singleton actor), `Entry` (struct: `container: LinuxContainer`, `ext4Artifacts: [URL]`), `register(siteID:container:ext4Artifacts:) async`, `reclaim(siteID:) -> Entry?`, `teardownAll() async`, `static func siteIDToEvict(order:capacity:) -> String?` (pure, unit-tested directly). Task 4 (`ContainerizationControl.suspend`) calls `register`; Task 5 (`ContainerizationControl.start`'s fast path) calls `reclaim`; Task 7 (`AppDelegate.applicationShouldTerminate`) calls `teardownAll`.

- [ ] **Step 1: Write the failing test for the pure eviction decision**

Create `Tests/AnglesiteContainerLocalTests/PausedContainerRegistryTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteContainer

struct PausedContainerRegistryTests {
    @Test
    func evictsOldestOnlyWhenAtCapacity() {
        #expect(PausedContainerRegistry.siteIDToEvict(order: [], capacity: 2) == nil)
        #expect(PausedContainerRegistry.siteIDToEvict(order: ["a"], capacity: 2) == nil)
        #expect(PausedContainerRegistry.siteIDToEvict(order: ["a", "b"], capacity: 2) == "a")
        #expect(PausedContainerRegistry.siteIDToEvict(order: ["a", "b", "c"], capacity: 2) == "a")
    }

    @Test
    func reclaimReturnsNilForUnknownSiteID() async {
        let registry = PausedContainerRegistry()
        #expect(await registry.reclaim(siteID: "never-registered") == nil)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `ANGLESITE_CONTAINER_TESTS=1 swift test --package-path . --filter PausedContainerRegistryTests`
Expected: FAIL — `PausedContainerRegistry` does not exist yet.

- [ ] **Step 3: Implement `PausedContainerRegistry`**

Create `Sources/AnglesiteContainer/PausedContainerRegistry.swift`:

```swift
import Foundation
import Containerization

/// Process-wide holder for site VMs that have been paused (not torn down) on window close —
/// see docs/superpowers/plans/2026-07-27-suspend-container-on-window-close.md. Must be a true
/// singleton (like `SharedVmnetNetwork.shared`/`RootfsTemplateCache.shared` in
/// `ContainerizationControl.swift`), NOT owned by a `ContainerizationControl` instance: each
/// `LiveSiteRuntimeFactory.makeRuntime` call constructs a fresh `ContainerizationControl()` (and
/// thus a fresh, per-window `LiveContainers`) every time a site window opens — including
/// reopening the same site after its previous window fully closed — so a paused container
/// recorded anywhere per-window would become unreachable the moment that window's object graph
/// deallocates.
public actor PausedContainerRegistry {
    public static let shared = PausedContainerRegistry()

    /// Each paused VM still reserves its full 2 vCPU / 2GB (`ContainerizationControl.swift:445-446`)
    /// — `pause()` freezes guest execution in place, it does not release the memory
    /// Virtualization.framework allocated at boot. Capped so an unbounded number of backgrounded
    /// site windows can't slowly exhaust host resources; worst case with this cap is
    /// `maxPaused` × 2 vCPU/2GB paused, plus whatever the currently-focused window's own VM costs.
    public static let maxPaused = 2

    public struct Entry: Sendable {
        public let container: LinuxContainer
        public let ext4Artifacts: [URL]
    }

    private var entries: [String: Entry] = [:]
    /// Least-recently-suspended siteID first.
    private var order: [String] = []

    public init() {}

    /// Registers a newly-paused container for `siteID`, evicting (fully tearing down) the
    /// least-recently-suspended entry first if this would exceed `maxPaused`.
    public func register(siteID: String, container: LinuxContainer, ext4Artifacts: [URL]) async {
        if let evictSiteID = Self.siteIDToEvict(order: order, capacity: Self.maxPaused),
           let victim = entries.removeValue(forKey: evictSiteID) {
            order.removeAll { $0 == evictSiteID }
            await Self.teardown(victim, siteID: evictSiteID)
        }
        entries[siteID] = Entry(container: container, ext4Artifacts: ext4Artifacts)
        order.append(siteID)
    }

    /// Removes and returns the paused entry for `siteID`, or `nil` if none is registered (a
    /// site that's never been suspended, or one evicted/torn down since it was).
    public func reclaim(siteID: String) -> Entry? {
        guard let entry = entries.removeValue(forKey: siteID) else { return nil }
        order.removeAll { $0 == siteID }
        return entry
    }

    /// Tears down every currently-paused container — called once, at app quit
    /// (`AppDelegate.applicationShouldTerminate`), so quitting never leaves an orphaned paused VM
    /// or stale ext4 artifact on disk (nothing will ever resume them after the process exits).
    public func teardownAll() async {
        for (siteID, entry) in entries {
            await Self.teardown(entry, siteID: siteID)
        }
        entries = [:]
        order = []
    }

    /// Pure eviction decision, factored out so it's testable without a real `LinuxContainer`: the
    /// least-recently-suspended siteID, once `order` would reach `capacity`, else `nil`.
    static func siteIDToEvict(order: [String], capacity: Int) -> String? {
        order.count >= capacity ? order.first : nil
    }

    /// Tears down one paused entry. The VM may still be genuinely paused (never resumed) —
    /// `LinuxContainer.stop()` requires the underlying VM to be `.running`
    /// (`VZVirtualMachineInstance.stop()`'s own `guard self.state == .running` throws "vm is not
    /// running" otherwise, and a paused VM's `VirtualMachineInstanceState` reads `.unknown`, not
    /// `.running` — `vzStateToInstanceState()` has no `.paused` case, see Task 1's probe finding).
    /// So every paused entry must be resumed before it can be stopped cleanly. Best-effort
    /// throughout (`try?`), matching every other teardown path in `ContainerizationControl.swift`.
    static func teardown(_ entry: Entry, siteID: String) async {
        try? await entry.container.withVirtualMachineInstance { vm in try await vm.resume() }
        try? await entry.container.stop()
        await SharedVmnetNetwork.shared.release(siteID: siteID)
        for url in entry.ext4Artifacts { try? FileManager.default.removeItem(at: url) }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ANGLESITE_CONTAINER_TESTS=1 swift test --package-path . --filter PausedContainerRegistryTests`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteContainer/PausedContainerRegistry.swift Tests/AnglesiteContainerLocalTests/PausedContainerRegistryTests.swift
git commit -m "feat(container): add PausedContainerRegistry for suspend-on-close"
```

---

## Task 3: `LocalContainerControl.suspend(siteID:)` protocol seam

Add the new capability to the cross-platform protocol with a safe default (`suspend` degrades to a full `stop`) so `PodmanContainerControl` (Linux) and every existing test fake keep compiling unchanged — only `ContainerizationControl` (Task 4) actually overrides it. This mirrors the existing `resetNetworking()` default-extension pattern in the same file.

**Files:**
- Modify: `Sources/AnglesiteCore/LocalContainerControl.swift`
- Modify: `Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift`
- Test: `Tests/AnglesiteCoreTests/LocalContainerControlSuspendDefaultTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LocalContainerControl.suspend(siteID: String) async throws` (protocol requirement with a default extension), `FakeLocalContainerControl.suspended: [String]` (new tracking array, mirroring `stopped`) — Task 6's `LocalContainerSiteRuntimeTests` additions consume this to distinguish a real suspend call from a real stop call.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/LocalContainerControlSuspendDefaultTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

struct LocalContainerControlSuspendDefaultTests {
    /// A conformer that implements nothing beyond the protocol's required methods — proving the
    /// default `suspend(siteID:)` extension (Task 3) really delegates to `stop(siteID:)` rather
    /// than silently no-op'ing, which every conformer that hasn't opted into a real pause
    /// (`PodmanContainerControl`, every existing test fake) relies on.
    actor MinimalControl: LocalContainerControl {
        private(set) var stopped: [String] = []

        func start(siteID: String, sourceRepo: URL, ref: String,
                   onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void) async throws -> LocalContainerSession {
            LocalContainerSession(previewURL: URL(string: "http://127.0.0.1:1")!, mcpURL: URL(string: "http://127.0.0.1:2")!)
        }
        func stop(siteID: String) async throws { stopped.append(siteID) }
        func exec(siteID: String, argv: [String], environment: [String: String], workingDirectory: String,
                   onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void) async throws -> ContainerExecResult {
            ContainerExecResult(exitCode: 0, stdout: "", stderr: "")
        }
        func execInteractive(siteID: String, argv: [String], environment: [String: String], workingDirectory: String,
                              onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void) async throws -> InteractiveExecHandle {
            InteractiveExecHandle(write: { _ in }, terminate: {})
        }
        func startWorkersDev(siteID: String, workers: [WorkerDescriptor],
                              onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void) async throws -> URL {
            URL(string: "http://127.0.0.1:3")!
        }
        func stopWorkersDev(siteID: String) async throws {}
    }

    @Test
    func defaultSuspendDelegatesToStop() async throws {
        let control = MinimalControl()
        try await control.suspend(siteID: "site-1")
        #expect(await control.stopped == ["site-1"])
    }
}
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `swift test --package-path . --filter LocalContainerControlSuspendDefaultTests`
Expected: FAIL — `suspend` is not a member of `LocalContainerControl`.

- [ ] **Step 3: Add `suspend(siteID:)` to the protocol with a default extension**

Edit `Sources/AnglesiteCore/LocalContainerControl.swift`. Add the requirement right after `stop(siteID:)` (after line 131):

```swift
    func stop(siteID: String) async throws

    /// Pauses the running VM for `siteID` in place instead of tearing it down — the guest's
    /// astro/mcp/bridge processes freeze exactly where they are (Virtualization.framework
    /// `pause()`, reached via `LinuxContainer.withVirtualMachineInstance`), rather than exiting. A
    /// later `start(siteID:sourceRepo:ref:onOutput:)` call for the SAME siteID resumes this paused
    /// VM (skipping the boot/clone/hydrate path entirely) if it's still registered in
    /// `PausedContainerRegistry`, or boots fresh otherwise (first-ever open, or the paused entry
    /// was evicted/reclaimed by app quit).
    ///
    /// Defaults to a full `stop(siteID:)` below for conformers with no pause capability of their
    /// own (`PodmanContainerControl` on Linux, every test fake) — only `ContainerizationControl`
    /// overrides this with a real pause. A conformer that inherits the default gets today's
    /// existing behavior unchanged: "suspend" on window close is just "stop."
    func suspend(siteID: String) async throws
```

Add the default implementation to the existing extension at the bottom of the file:

```swift
extension LocalContainerControl {
    public func resetNetworking() async {}

    public func suspend(siteID: String) async throws {
        try await stop(siteID: siteID)
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --package-path . --filter LocalContainerControlSuspendDefaultTests`
Expected: PASS.

- [ ] **Step 5: Run the full AnglesiteCoreTests suite to confirm no existing conformer broke**

Run: `swift test --package-path . --filter AnglesiteCoreTests`
Expected: PASS — `PodmanContainerControl` and every fake in `FakeLocalContainerControl.swift` keep compiling via the inherited default; nothing needed to change on them.

- [ ] **Step 6: Add a `suspended` tracking array to `FakeLocalContainerControl`**

Task 6's tests need to prove `LocalContainerSiteRuntime.suspend()` calls `control.suspend(siteID:)` (not `control.stop(siteID:)`) — which requires the fake to track suspend calls SEPARATELY from stop calls, rather than inheriting the default (which would make both land in the same `stopped` array and the distinction untestable).

Edit `Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift`. Add a new tracking property next to `stopped` (after line 6):

```swift
    private(set) var stopped: [String] = []
    private(set) var suspended: [String] = []
```

Add the conformance method next to `stop(siteID:)` (after line 68):

```swift
    func stop(siteID: String) async throws { stopped.append(siteID) }

    func suspend(siteID: String) async throws { suspended.append(siteID) }
```

- [ ] **Step 7: Run the full test target again to confirm the fake update compiles cleanly**

Run: `swift test --package-path . --filter AnglesiteCoreTests`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add Sources/AnglesiteCore/LocalContainerControl.swift Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift Tests/AnglesiteCoreTests/LocalContainerControlSuspendDefaultTests.swift
git commit -m "feat(core): add LocalContainerControl.suspend with stop-based default"
```

---

## Task 4: `ContainerizationControl.suspend(siteID:)` — real pause implementation

Overrides the default from Task 3: stops this site's host-side proxies and any active workers-dev session (neither is preserved across a pause — resuming re-dials fresh proxies in Task 5, and workers-dev restarts fresh the same way a cold boot would, via `LocalContainerSiteRuntime.startWorkersDevIfActive`), pauses the VM, and hands the container off to `PausedContainerRegistry` instead of deleting it. Deliberately does **not** release the site's vmnet allocation or delete its ext4 artifacts — both must survive for a later resume.

**Files:**
- Modify: `Sources/AnglesiteContainer/ContainerizationControl.swift` (add `suspend(siteID:)`, add three small accessors to `LiveContainers`)
- Modify: `Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift` (add a gated e2e test)

**Interfaces:**
- Consumes: `PausedContainerRegistry.shared.register(siteID:container:ext4Artifacts:)` (Task 2), `LiveContainers.teardownWorkersDev(siteID:)` (existing).
- Produces: `ContainerizationControl.suspend(siteID:) async throws` (overrides the Task 3 default), `LiveContainers.ext4Artifacts(for:) -> [URL]`, `LiveContainers.forget(siteID:)`, `LiveContainers.stopProxiesOnly(siteID:) async` — all three consumed only by `suspend` in this task and by Task 5's resume path.

- [ ] **Step 1: Write the failing e2e test**

Edit `Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift`. Add (inside the existing `struct ContainerizationControlTests`, alongside `bootsAndServes`):

```swift
    @Test
    func suspendPausesWithoutDeletingArtifacts() async throws {
        try #require(enabled, "set ANGLESITE_CONTAINER_E2E=1 on an entitled Apple-Silicon Mac")
        let control = ContainerizationControl()
        let siteID = "suspend-test-\(UUID().uuidString.prefix(8))"
        let repo = try Self.makeThrowawayAstroRepo()  // existing helper used by bootsAndServes

        _ = try await control.start(siteID: siteID, sourceRepo: repo, ref: "HEAD", onOutput: { _, _ in })
        try await control.suspend(siteID: siteID)

        let entry = await PausedContainerRegistry.shared.reclaim(siteID: siteID)
        #expect(entry != nil)
        for url in entry?.ext4Artifacts ?? [] {
            #expect(FileManager.default.fileExists(atPath: url.path))
        }
        // Cleanup: reclaim() already removed it from the registry — tear it down for real so the
        // test doesn't leak a paused VM.
        if let entry { await PausedContainerRegistry.teardown(entry, siteID: siteID) }
    }
```

(If `Self.makeThrowawayAstroRepo()` isn't the exact existing helper name, read `bootsAndServes` in the same file first and reuse whatever it actually calls to build its throwaway repo — do not invent a new one.)

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `ANGLESITE_CONTAINER_TESTS=1 swift test --package-path . --filter ContainerizationControlTests`
Expected: FAIL — `suspend(siteID:)` is not yet overridden with real behavior (it currently resolves to the Task 3 default, which fully stops and deletes artifacts, so `entry` will be `nil` and/or the ext4 files will be gone).

- [ ] **Step 3: Add accessors to `LiveContainers`**

Edit `Sources/AnglesiteContainer/ContainerizationControl.swift`. Add these methods to the `actor LiveContainers` block (after `container(for:)`, around line 1150):

```swift
    func container(for siteID: String) -> LinuxContainer? { containers[siteID] }

    /// The ext4 rootfs/initfs artifact paths recorded for `siteID`, or `[]` if none — read by
    /// `suspend(siteID:)` to hand them off to `PausedContainerRegistry` before this instance
    /// forgets the site entirely.
    func ext4Artifacts(for siteID: String) -> [URL] { ext4Artifacts[siteID] ?? [] }

    /// Drops all bookkeeping for `siteID` WITHOUT stopping anything — used by `suspend(siteID:)`
    /// once the container and its ext4 artifacts have been handed off to
    /// `PausedContainerRegistry`, so this (per-window) instance no longer believes it owns a site
    /// whose lifecycle another owner now controls.
    func forget(siteID: String) {
        containers[siteID] = nil
        proxies[siteID] = nil
        ext4Artifacts[siteID] = nil
    }

    /// Stops just this site's host-side proxies, leaving the container and its ext4 artifacts
    /// untouched — the proxy half of a full `teardown(siteID:)`, used by `suspend(siteID:)` (a
    /// paused VM has nothing listening to proxy to; fresh proxies are re-dialed on resume).
    func stopProxiesOnly(siteID: String) async {
        for p in proxies[siteID] ?? [] { await p.stop() }
        proxies[siteID] = nil
    }
```

- [ ] **Step 4: Implement `ContainerizationControl.suspend(siteID:)`**

Edit `Sources/AnglesiteContainer/ContainerizationControl.swift`. Add this method right after `stop(siteID:)` (after line 197):

```swift
    public func stop(siteID: String) async throws {
        await live.teardown(siteID: siteID)
        await network.release(siteID: siteID)
    }

    /// `LocalContainerControl.suspend(siteID:)` conformance: pauses the VM in place instead of
    /// tearing it down, handing the container off to the process-wide `PausedContainerRegistry` so
    /// it survives this (per-window) `ContainerizationControl`/`LiveContainers` instance being
    /// deallocated when the window closes. Deliberately does NOT call `network.release(siteID:)` —
    /// the guest's virtual NIC must keep its allocated vmnet IP while paused, or a later `resume()`
    /// would come back on a network the host has already handed to a different site.
    public func suspend(siteID: String) async throws {
        guard let container = await live.container(for: siteID) else {
            throw LocalContainerError.bootFailed("suspend: no live container for siteID '\(siteID)'")
        }
        // Workers-dev isn't preserved across a suspend — `LocalContainerSiteRuntime.start()`
        // recomputes and restarts it fresh via `startWorkersDevIfActive` after a resume, exactly
        // as it would after a cold boot.
        await live.teardownWorkersDev(siteID: siteID)
        await live.stopProxiesOnly(siteID: siteID)
        try await container.withVirtualMachineInstance { vm in try await vm.pause() }
        let artifacts = await live.ext4Artifacts(for: siteID)
        await live.forget(siteID: siteID)
        await PausedContainerRegistry.shared.register(siteID: siteID, container: container, ext4Artifacts: artifacts)
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `ANGLESITE_CONTAINER_TESTS=1 swift test --package-path . --filter ContainerizationControlTests`
Expected: PASS on entitled Apple-Silicon hardware (skips with a clear message otherwise, per the existing `enabled` gate).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteContainer/ContainerizationControl.swift Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift
git commit -m "feat(container): implement real VM pause in ContainerizationControl.suspend"
```

---

## Task 5: `ContainerizationControl.start(...)` — resume a paused container before cold-booting

Teaches `start()` to check `PausedContainerRegistry` first. If a paused entry exists for this `siteID`, resume the VM and re-dial fresh proxies (skipping rootfs unpack, VM boot, git clone/checkout, and detached process launch entirely) instead of the full cold-boot path. If resume fails for any reason, tear down the broken paused entry and fall through to today's existing cold-boot path unchanged — a failed resume must never strand the user.

**Files:**
- Modify: `Sources/AnglesiteContainer/ContainerizationControl.swift`
- Modify: `Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift`

**Interfaces:**
- Consumes: `PausedContainerRegistry.shared.reclaim(siteID:)`, `PausedContainerRegistry.teardown(_:siteID:)` (both from Task 2/4), `EventRateLimiter`, `VsockTCPProxy`, `VsockDialer`, `waitUntilServing(_:timeout:interval:)` (all existing, same file).
- Produces: the same `start(siteID:sourceRepo:ref:onOutput:) async throws -> LocalContainerSession` signature — no caller-visible change; `LocalContainerSiteRuntime` and every existing test call `start()` exactly as before.

- [ ] **Step 1: Write the failing e2e test**

Edit `Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift`. Add:

```swift
    @Test
    func startResumesAPausedContainerInsteadOfColdBooting() async throws {
        try #require(enabled, "set ANGLESITE_CONTAINER_E2E=1 on an entitled Apple-Silicon Mac")
        let control = ContainerizationControl()
        let siteID = "resume-test-\(UUID().uuidString.prefix(8))"
        let repo = try Self.makeThrowawayAstroRepo()

        let firstSession = try await control.start(siteID: siteID, sourceRepo: repo, ref: "HEAD", onOutput: { _, _ in })
        try await control.suspend(siteID: siteID)

        let start = ContinuousClock.now
        let resumedSession = try await control.start(siteID: siteID, sourceRepo: repo, ref: "HEAD", onOutput: { _, _ in })
        let elapsed = ContinuousClock.now - start

        // A resume never re-hydrates the guest (no clone/npm install/astro cold start), so it must
        // land well under the ~186s+ a cold boot pays (`previewReadyTimeout`'s own doc comment) —
        // 30s gives ample margin over VM-resume + proxy-redial + short readiness poll while still
        // catching a regression that silently fell back to a full cold boot.
        #expect(elapsed < .seconds(30))
        #expect(resumedSession.previewURL != firstSession.previewURL || resumedSession.mcpURL != firstSession.mcpURL)

        try await control.stop(siteID: siteID)
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ANGLESITE_CONTAINER_TESTS=1 swift test --package-path . --filter ContainerizationControlTests`
Expected: FAIL (or a very slow PASS) — `start()` doesn't yet check the registry, so the second call cold-boots from scratch, taking minutes, not seconds.

- [ ] **Step 3: Add the fast-resume path to `start()`**

Edit `Sources/AnglesiteContainer/ContainerizationControl.swift`. Insert at the very top of `start(siteID:sourceRepo:ref:onOutput:)`, before the existing `let cloneSource = ...` line (before line 61):

```swift
    public func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        if let paused = await PausedContainerRegistry.shared.reclaim(siteID: siteID) {
            if let session = try? await resumeSession(siteID: siteID, entry: paused, onOutput: onOutput) {
                return session
            }
            // The paused entry is unusable (resume failed, or the proxies/readiness check that
            // follows it failed) — it's already been removed from the registry by `reclaim`
            // above, so this instance now owns tearing it down. Never leave the user stuck on a
            // broken resume: fall through to a normal cold boot.
            onOutput("[resume] resuming the paused VM failed; falling back to a cold boot", .stderr)
            await PausedContainerRegistry.teardown(paused, siteID: siteID)
        }

        // Resolves the split-repo gitfile layout (#888/#903): share the directory git can
```

(The comment `// Resolves the split-repo gitfile layout...` marks the first line of the existing cold-boot body — leave everything from `let cloneSource = ...` onward completely unchanged.)

- [ ] **Step 4: Add the `resumeSession` helper**

Edit the same file. Add this private method near `makeBareContainer` (e.g. right before it, since both are boot-adjacent helpers):

```swift
    /// Resumes a VM `suspend(siteID:)` (Task 4) previously paused: unpauses it, re-dials fresh
    /// host-side proxies for the preview and MCP ports (the guest's astro/mcp processes and their
    /// vsock-bridge `socat` listeners never stopped — only the VM's execution was frozen — so a
    /// fresh `dialVsock` reaches them immediately, per Task 1's probe), and waits briefly for the
    /// preview port to answer before handing the resumed container back to `live`. Workers-dev is
    /// NOT resumed here — `LocalContainerSiteRuntime.start()` recomputes and restarts it fresh via
    /// `startWorkersDevIfActive` once this returns `.ready`, exactly as a cold boot would.
    private func resumeSession(
        siteID: String,
        entry: PausedContainerRegistry.Entry,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        let container = entry.container
        onOutput("[resume] resuming paused VM", .stdout)
        try await container.withVirtualMachineInstance { vm in try await vm.resume() }

        let dial: VsockDialer = { port in try await container.dialVsock(port: port) }
        let eventLimiter = EventRateLimiter()
        let previewProxy = VsockTCPProxy(
            guestPort: Self.previewPort, dial: dial,
            onDialError: { error in
                eventLimiter.log("[proxy:preview] dialVsock(\(Self.previewPort)) failed: \(error)", onOutput: onOutput)
            },
            onEvent: { event in eventLimiter.log("[proxy:preview] \(event)", onOutput: onOutput) })
        let mcpProxy = VsockTCPProxy(
            guestPort: Self.mcpPort, dial: dial,
            onDialError: { error in
                eventLimiter.log("[proxy:mcp] dialVsock(\(Self.mcpPort)) failed: \(error)", onOutput: onOutput)
            },
            onEvent: { event in eventLimiter.log("[proxy:mcp] \(event)", onOutput: onOutput) })

        let previewURL: URL
        let mcpURL: URL
        do {
            previewURL = try await previewProxy.start()
            let mcpBase = try await mcpProxy.start()
            mcpURL = mcpBase.appendingPathComponent("mcp")
        } catch {
            await previewProxy.stop()
            await mcpProxy.stop()
            throw LocalContainerError.bootFailed("resume proxy start failed: \(error)")
        }

        do {
            try await waitUntilServing(previewURL, timeout: Self.resumeReadyTimeout)
        } catch {
            await previewProxy.stop()
            await mcpProxy.stop()
            throw LocalContainerError.bootFailed("resumed preview server did not become ready: \(error)")
        }

        onOutput("[resume] VM resumed", .stdout)
        await live.store(
            siteID: siteID, container: container,
            proxies: [previewProxy, mcpProxy], ext4Artifacts: entry.ext4Artifacts)
        return LocalContainerSession(previewURL: previewURL, mcpURL: mcpURL)
    }

    /// Bound on `waitUntilServing` after a resume: the guest process never died (only the VM's
    /// execution froze), so it should answer almost immediately — unlike `previewReadyTimeout`
    /// (300s), which budgets for a full cold `npm install`/`astro dev` start.
    private static let resumeReadyTimeout: Duration = .seconds(20)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `ANGLESITE_CONTAINER_TESTS=1 swift test --package-path . --filter ContainerizationControlTests`
Expected: PASS — the second `start()` call completes in well under 30s.

- [ ] **Step 6: Run the full gated container-local suite to confirm no regression**

Run: `ANGLESITE_CONTAINER_TESTS=1 ANGLESITE_CONTAINER_E2E=1 swift test --package-path . --filter AnglesiteContainerLocalTests`
Expected: PASS (all existing tests, e.g. `bootsAndServes`, `startsWorkersDevForActiveWorker`, unaffected).

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteContainer/ContainerizationControl.swift Tests/AnglesiteContainerLocalTests/ContainerizationControlTests.swift
git commit -m "feat(container): resume a paused VM in start() before cold-booting"
```

---

## Task 6: `SiteRuntime.suspend()` + `LocalContainerSiteRuntime` conformance

Mirrors Task 3's protocol-level pattern one layer up: `SiteRuntime` gets a `suspend()` requirement defaulting to `stop()`, so `RemoteSandboxSiteRuntime` and `UnavailableSiteRuntime` need zero changes. Only `LocalContainerSiteRuntime` overrides it, routing through `control.suspend(siteID:)` instead of `control.stop(siteID:)` — everything else `teardown()` already does (unload knowledge/semantic/conventions indexes, stop the file watcher, stop the MCP client) stays identical, since a resumed container gets a fresh MCP HTTP connection and a rebuilt index the same way a cold boot's `start()` already does.

**Files:**
- Modify: `Sources/AnglesiteCore/SiteRuntime.swift`
- Modify: `Sources/AnglesiteCore/LocalContainerSiteRuntime.swift`
- Test: `Tests/AnglesiteCoreTests/LocalContainerSiteRuntimeTests.swift`

**Interfaces:**
- Consumes: `FakeLocalContainerControl.suspended`/`.stopped` (Task 3).
- Produces: `SiteRuntime.suspend() async` (protocol requirement + stop-based default extension), `LocalContainerSiteRuntime.suspend() async` (real override) — consumed by Task 7's `PreviewModel.close()`.

- [ ] **Step 1: Write the failing test**

Edit `Tests/AnglesiteCoreTests/LocalContainerSiteRuntimeTests.swift`. Read the file first to match its existing setup helper (how it constructs a `LocalContainerSiteRuntime` wired to a `FakeLocalContainerControl` and drives it to `.ready`), then add a test alongside the existing `stop()`-focused ones:

```swift
    @Test
    func suspendCallsControlSuspendNotControlStop() async throws {
        let control = FakeLocalContainerControl(startResult: .success(
            LocalContainerSession(previewURL: URL(string: "http://127.0.0.1:1")!, mcpURL: URL(string: "http://127.0.0.1:2")!)))
        let runtime = makeRuntime(control: control)  // reuse this file's existing construction helper
        await runtime.start(siteID: "site-1", siteDirectory: URL(fileURLWithPath: "/tmp/site-1"))

        await runtime.suspend()

        #expect(await control.suspended == ["site-1"])
        #expect(await control.stopped == [])
    }

    @Test
    func stopStillCallsControlStopNotControlSuspend() async throws {
        let control = FakeLocalContainerControl(startResult: .success(
            LocalContainerSession(previewURL: URL(string: "http://127.0.0.1:1")!, mcpURL: URL(string: "http://127.0.0.1:2")!)))
        let runtime = makeRuntime(control: control)
        await runtime.start(siteID: "site-1", siteDirectory: URL(fileURLWithPath: "/tmp/site-1"))

        await runtime.stop()

        #expect(await control.stopped == ["site-1"])
        #expect(await control.suspended == [])
    }
```

(If the file's existing helper for constructing a `LocalContainerSiteRuntime` has a different name/signature than `makeRuntime(control:)`, use the real one — do not invent a signature that doesn't match the file's existing tests.)

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `swift test --package-path . --filter LocalContainerSiteRuntimeTests`
Expected: FAIL — `SiteRuntime`/`LocalContainerSiteRuntime` have no `suspend()` member yet.

- [ ] **Step 3: Add `suspend()` to the `SiteRuntime` protocol with a stop-based default**

Edit `Sources/AnglesiteCore/SiteRuntime.swift`. Add the requirement right after `stop()` (after line 76):

```swift
public protocol SiteRuntime: Actor {
    func start(siteID: String, siteDirectory: URL) async
    func stop() async

    /// Pauses this site's runtime instead of fully stopping it, when the substrate supports it —
    /// e.g. `LocalContainerSiteRuntime` pauses the VM in place so a later `start(siteID:
    /// siteDirectory:)` for the SAME siteID resumes in seconds instead of cold-booting. Defaults
    /// to a full `stop()` below for every conformer without a pause capability
    /// (`RemoteSandboxSiteRuntime`, `UnavailableSiteRuntime`) — closing a window against one of
    /// those behaves exactly as it does today.
    func suspend() async

    func observe() -> AsyncStream<SiteRuntimeState>
```

Add the default to the existing protocol extension at the bottom of the file:

```swift
public extension SiteRuntime {
    nonisolated var containerCapability: (any SiteRuntimeContainerCapability)? { nil }

    func suspend() async { await stop() }
}
```

- [ ] **Step 4: Override `suspend()` in `LocalContainerSiteRuntime`**

Edit `Sources/AnglesiteCore/LocalContainerSiteRuntime.swift`. Change `teardown()`'s signature to take a mode flag (edit the existing method at line 453):

```swift
    private func teardown(suspending: Bool = false) async {
```

Change the one line inside it that stops the control (currently line 479-481):

```swift
        if let id = containerSiteID {
            if suspending {
                try? await control.suspend(siteID: id)
            } else {
                try? await control.stop(siteID: id)
            }
        }
```

Add the new public method right after `stop()` (after line 449):

```swift
    /// `SiteRuntime.suspend()` conformance: pauses the container instead of tearing it down (see
    /// `LocalContainerControl.suspend(siteID:)`). Otherwise identical to `stop()` — the MCP client
    /// still disconnects and the knowledge/semantic/conventions indexes still unload, exactly as a
    /// cold boot's `start()` already re-establishes them, since a resumed VM gets a fresh MCP HTTP
    /// connection (the old one's underlying vsock proxy no longer exists — Task 5 re-dials a new
    /// one on resume) rather than a preserved one.
    public func suspend() async {
        let gen = stateMachine.beginAttempt()
        await teardown(suspending: true)
        stateMachine.settle(gen: gen, to: .idle)
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `swift test --package-path . --filter LocalContainerSiteRuntimeTests`
Expected: PASS.

- [ ] **Step 6: Run the full AnglesiteCoreTests suite to confirm no regression**

Run: `swift test --package-path .`
Expected: PASS (all existing `SiteRuntime`/`LocalContainerSiteRuntime` tests unaffected; `RemoteSandboxSiteRuntime`/`UnavailableSiteRuntime` compile unchanged via the inherited default).

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/SiteRuntime.swift Sources/AnglesiteCore/LocalContainerSiteRuntime.swift Tests/AnglesiteCoreTests/LocalContainerSiteRuntimeTests.swift
git commit -m "feat(core): add SiteRuntime.suspend with a real pause for local containers"
```

---

## Task 7: Wire window close to `suspend()`, and app quit to full teardown

`PreviewModel.close()` (the window-close teardown path, called from `SiteWindowModel.close()`, called from `SiteWindow`'s `.onDisappear`) currently calls `runtime.stop()`. Switch it to `runtime.suspend()`. `PreviewModel.stopDevServer()` (the explicit Site ▸ Stop Dev Server action) keeps calling `runtime.stop()` unchanged — that's a real, user-requested stop. Add an app-quit hook so a paused VM never survives past the app process's own lifetime with stale ext4 artifacts left on disk.

**Files:**
- Modify: `Sources/AnglesiteApp/PreviewModel.swift`
- Modify: `Sources/AnglesiteApp/AnglesiteApp.swift`
- Test: `Tests/AnglesiteAppTests/PreviewModelSuspendOnCloseTests.swift`

**Interfaces:**
- Consumes: `SiteRuntime.suspend()`/`.stop()` (Task 6), `PausedContainerRegistry.shared.teardownAll()` (Task 2).
- Produces: nothing new — this is the final wiring task; no later task depends on it.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteAppTests/PreviewModelSuspendOnCloseTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore
@testable import AnglesiteApp

/// Records whether `stop()` or `suspend()` was called, without doing anything else — isolates
/// exactly the one behavior this test needs to prove: `PreviewModel.close()` must call `suspend()`,
/// not `stop()`, so a closed-then-reopened site window can resume instead of cold-booting.
private actor SpySiteRuntime: SiteRuntime {
    private(set) var stopCalls = 0
    private(set) var suspendCalls = 0
    let mcpClient = MCPClient(supervisor: .shared)
    private let (stream, continuation) = AsyncStream<SiteRuntimeState>.makeStream()

    func start(siteID: String, siteDirectory: URL) async {
        continuation.yield(.ready(siteID: siteID, url: URL(string: "http://127.0.0.1:1")!))
    }
    func stop() async { stopCalls += 1 }
    func suspend() async { suspendCalls += 1 }
    func observe() -> AsyncStream<SiteRuntimeState> { stream }
}

@Suite("PreviewModel suspend-on-close")
struct PreviewModelSuspendOnCloseTests {
    @Test
    @MainActor
    func closeSuspendsRatherThanStops() async throws {
        let runtime = SpySiteRuntime()
        let model = PreviewModel(runtime: runtime)
        model.open(site: /* whatever CurrentSite/site value this initializer's existing tests use */)

        model.close()
        try await Task.sleep(for: .milliseconds(50))  // close() dispatches its teardown in a Task

        #expect(await runtime.suspendCalls == 1)
        #expect(await runtime.stopCalls == 0)
    }
}
```

Before finalizing this file, read `Tests/AnglesiteAppTests/PreviewModelContainerCapabilityTests.swift` (the existing fake `FakeContainerCapableSiteRuntime` at line 53) and any existing `PreviewModel.open(...)` call in that file or `SiteWindowModelTests.swift` to match the REAL `open(...)` signature/site-value construction this codebase uses — do not guess it; the sketch above marks the one spot that needs the real call.

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `swift test --package-path . --filter PreviewModelSuspendOnCloseTests`
Expected: FAIL — `PreviewModel.close()` still calls `stop()`, so `suspendCalls == 0` and `stopCalls == 1`.

- [ ] **Step 3: Switch `PreviewModel.close()` to `suspend()`**

Edit `Sources/AnglesiteApp/PreviewModel.swift`. Change line 223:

```swift
    func close() {
        let previousSiteID = openSiteID
        openSiteID = nil
        openSiteDirectory = nil
        devServerStoppedByUser = false
        Task {
            if let previousSiteID {
                await EditRouterRegistry.shared.unregister(siteID: previousSiteID)
            }
            await runtime.suspend()
        }
    }
```

(`stopDevServer()` at line 308-321 is intentionally left unchanged — it must keep calling `await runtime.stop()`, since Site ▸ Stop Dev Server is an explicit user request to actually stop, not a window-close suspend.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --package-path . --filter PreviewModelSuspendOnCloseTests`
Expected: PASS.

- [ ] **Step 5: Add the app-quit teardown hook**

Edit `Sources/AnglesiteApp/AnglesiteApp.swift`. Add the import (after line 4):

```swift
import AnglesiteContainer
```

Change `applicationShouldTerminate` (lines 120-126):

```swift
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task {
            await ProcessSupervisor.shared.shutdownAll(timeout: 5)
            await PausedContainerRegistry.shared.teardownAll()
            await MainActor.run { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }
```

- [ ] **Step 6: Run the full AnglesiteAppTests suite**

Run: `swift test --package-path . --filter AnglesiteAppTests`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/PreviewModel.swift Sources/AnglesiteApp/AnglesiteApp.swift Tests/AnglesiteAppTests/PreviewModelSuspendOnCloseTests.swift
git commit -m "feat(app): suspend the container on window close instead of stopping it"
```

---

## Task 8: Full-app verification and manual QA pass

Automated tests can't drive real window close/reopen timing or observe the Debug pane's log output — this task is the manual confirmation the CLAUDE.md guidance ("For UI or frontend changes... use the feature in a browser/app before reporting complete") requires, plus the build/test commands CONTRIBUTING.md expects reported.

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: the fully-wired feature from Tasks 1–7.
- Produces: a verified end-to-end suspend/resume cycle, ready to hand off per `CONTRIBUTING.md`'s PR checklist.

- [ ] **Step 1: Build the hosted app**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED. (Run `xcodegen generate` first if the worktree's `Anglesite.xcodeproj` is missing/stale.)

- [ ] **Step 2: Run the full non-gated test suite**

Run: `swift test --package-path .`
Expected: PASS.

- [ ] **Step 3: Run the gated container suite on entitled hardware**

Run: `ANGLESITE_CONTAINER_TESTS=1 ANGLESITE_CONTAINER_E2E=1 swift test --package-path . --filter AnglesiteContainerLocalTests`
Expected: PASS.

- [ ] **Step 4: Manual end-to-end pass in the running app**

1. Launch `Anglesite.app`, open a real site, wait for the preview to reach `.ready`.
2. Close the site window (red traffic light).
3. Reopen the same site (File ▸ Open Recent, or Dock menu). Confirm the preview reaches `.ready` in a few seconds, not minutes — check the Debug pane for the `[resume] resuming paused VM` / `[resume] VM resumed` log lines (not a fresh `[boot] resolving bundled image/kernel artifacts` line).
4. Open a THIRD distinct site, close it, then a fourth — with `PausedContainerRegistry.maxPaused = 2`, confirm (via Debug pane / Activity Monitor VM count) that suspending a third site evicts (fully tears down) the least-recently-suspended one rather than accumulating indefinitely.
5. Use Site ▸ Stop Dev Server on an open site (not window close) — confirm it still fully stops (cold-boots on the next Start), unaffected by this change.
6. Quit the app while at least one site is paused (suspended, window closed, not reopened) — confirm on relaunch there's no leftover `rootfs-<siteID>.ext4`/`initfs-<siteID>.ext4` for that site under the `BundledImage.storeURL()` directory.

- [ ] **Step 5: Report results**

Summarize pass/fail for each of the above to the user before opening a PR, per `CONTRIBUTING.md`.

---

## Self-Review Notes

- **Spec coverage:** the user's ask ("suspend rather than shut down, reopen faster") is covered end-to-end: Task 1 validates the primitive is safe, Tasks 2–5 build the pause/resume/registry mechanism, Task 6–7 wire window close to it, Task 8 verifies it. The eviction cap and app-quit cleanup are included because leaving them out would either leak host resources across many backgrounded sites or leak disk artifacts across app quits — both directly regress today's behavior, not just "nice to have."
- **Deliberately out of scope (YAGNI):** a Settings UI for the `maxPaused` cap; preserving the workers-dev session across a suspend (it restarts fresh, same as a cold boot already does); resuming across an app relaunch (paused entries live in an in-memory registry, not on disk — `teardownAll()` at quit is exactly why this is safe to skip).
- **Placeholder scan:** every step has real, complete code; the two spots that reference "the file's existing helper" (Task 6 Step 1, Task 7 Step 1) explicitly instruct reading the real file first rather than guessing a signature — that's a deliberate instruction to look something up, not an unfilled placeholder.
- **Type consistency:** `PausedContainerRegistry.Entry` (Task 2) is used with the same two fields (`container`, `ext4Artifacts`) everywhere it's constructed/read (Tasks 4, 5). `suspend(siteID:)` appears on `LocalContainerControl` (Task 3), overridden in `ContainerizationControl` (Task 4) with an identical signature. `suspend()` appears on `SiteRuntime` (Task 6), overridden in `LocalContainerSiteRuntime` with an identical signature (Task 6), called from `PreviewModel.close()` (Task 7).
