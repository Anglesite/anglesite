import Foundation
import AnglesiteCore
import AnglesiteContainer
import Containerization
import ContainerizationError

// `anglesite-container-probe` — a standalone, entitled CLI for exercising
// `ContainerizationControl`'s live vsock/boot path outside `swift test`.
//
// swiftpm-testing-helper (the process `swift test` actually runs) cannot carry
// `com.apple.security.virtualization` — Apple's toolchain is not ours to re-sign — so a bare
// `swift test` can never reach VM creation for `AnglesiteContainerLocalTests`'s live cases: it
// fails before `dialVsock` is ever called. This probe links `AnglesiteContainer` directly into
// its own executable, which `scripts/run-container-probe.sh` code-signs with
// `Resources/container-probe.entitlements` after building, so the *actual* running process
// carries the entitlement `swift test` cannot grant.
//
// Subcommands:
//   echo  — mirrors VsockEchoEndToEndTests: bare container, guest socat vsock-echo listener,
//           host dialVsock round-trip. THE decision gate for Task 4b.
//   boot  — mirrors ContainerizationControlTests.bootsAndServes: full start() against a
//           throwaway Astro repo, polling the preview URL for a live HTTP response. Task 5's gate.
//   workers-dev — mirrors ContainerizationControlTests.startsWorkersDevForActiveWorker: boot a
//           container, start local wrangler-dev for one active (fixture) worker, poll its URL
//           for a live HTTP response. The #708 local-runtime feature's own decision gate.
//   pause-resume — bare container + guest vsock echo listener, confirm a round trip, pause the
//           VM, resume it, confirm a FRESH dial still reaches the listener, then EMPIRICALLY
//           confirm the resume-before-stop ordering: a direct `container.stop()` call while still
//           paused must throw, and a resume-then-stop must succeed cleanly. The decision gate for
//           the suspend-on-window-close plan.

@main
struct AnglesiteContainerProbe {
    static func main() async {
        let args = CommandLine.arguments.dropFirst()
        guard let subcommand = args.first else {
            FileHandle.standardError.write(Data("usage: anglesite-container-probe <echo|boot|workers-dev|pause-resume>\n".utf8))
            exit(2)
        }

        let exitCode: Int32
        switch subcommand {
        case "echo":
            exitCode = await runEcho()
        case "boot":
            exitCode = await runBoot()
        case "workers-dev":
            exitCode = await runWorkersDev()
        case "pause-resume":
            exitCode = await runPauseResume()
        default:
            FileHandle.standardError.write(
                Data("unknown subcommand '\(subcommand)' (expected echo|boot|workers-dev|pause-resume)\n".utf8))
            exitCode = 2
        }
        exit(exitCode)
    }

    /// Logs every guest-process output line to stderr, tagged with its stream — the same
    /// diagnostic trail `LocalContainerSiteRuntime`/the test suite capture via `onOutput`. A
    /// `@Sendable` closure constant (rather than a plain static method reference) so it converts
    /// cleanly to the `@Sendable (String, LogCenter.Stream) -> Void` the seam expects.
    private static let logLine: @Sendable (String, LogCenter.Stream) -> Void = { line, stream in
        FileHandle.standardError.write(Data("[\(stream)] \(line)\n".utf8))
    }

    // MARK: - echo

    /// Mirrors `VsockEchoEndToEndTests.vsockEchoRoundTrip`: boot a bare container (no repo
    /// mount), start a guest socat vsock-echo listener on :9999, dial it from the host, and
    /// confirm a round-tripped payload. THE live decision gate — see the task brief.
    private static func runEcho() async -> Int32 {
        let siteID = "vsock-echo-probe"
        let control = ContainerizationControl()

        let container: LinuxContainer
        do {
            container = try await control.makeBareContainer(siteID: siteID)
        } catch {
            print("GATE: FAIL — makeBareContainer threw: \(error)")
            return 1
        }

        // ALWAYS stopBareContainer on every exit path below — the defer-equivalent the brief
        // calls for. `defer` bodies can't `await`, so every early return funnels through this
        // instead of a literal `defer`.
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

        // Retry the dial until the listener is up (socat needs a beat to bind) — up to ~10s.
        var handle: FileHandle?
        var lastDialError: Error?
        for _ in 0..<40 {
            do {
                handle = try await container.dialVsock(port: 9999)
                break
            } catch {
                lastDialError = error
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        guard let fh = handle else {
            return await fail("GATE: FAIL — never dialed guest vsock :9999 within 10s; last error: "
                + "\(String(describing: lastDialError))")
        }

        let payload = Data("ping-vsock-echo\n".utf8)
        do {
            try fh.write(contentsOf: payload)
        } catch {
            return await fail("GATE: FAIL — write to vsock handle failed: \(error)")
        }

        // Read until the payload echoes back (or a 10s deadline) — the historical #69 signature
        // to watch for is dial-ok followed by an instant EOF/EPIPE (empty `availableData` forever).
        var received = Data()
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while received.count < payload.count, ContinuousClock.now < deadline {
            let chunk = fh.availableData
            if chunk.isEmpty {
                try? await Task.sleep(for: .milliseconds(100))
            } else {
                received.append(chunk)
            }
        }
        try? fh.close()

        guard received == payload else {
            return await fail("GATE: FAIL — echo mismatch: got \(received.count)/\(payload.count) bytes "
                + "(\(received as NSData)) — dial-ok/instant-EOF signature means the vsock data "
                + "path is broken at the framework layer")
        }

        print("GATE: PASS")
        await control.stopBareContainer(container, siteID: siteID)
        return 0
    }

    // MARK: - pause-resume

    /// Decision gate for the suspend-on-window-close feature (docs/superpowers/plans/
    /// 2026-07-27-suspend-container-on-window-close.md): boot a bare container with a guest vsock
    /// echo listener, confirm a round trip, pause the VM, resume it, and confirm a FRESH dial still
    /// reaches the (never-restarted) guest listener. Then EMPIRICALLY confirms the resume-before-stop
    /// ordering `PausedContainerRegistry.teardown` depends on: pauses again and calls
    /// `container.stop()` directly while still paused, confirming it actually throws (a still-paused
    /// VM's `VirtualMachineInstanceState` reads `.unknown`, not `.running`, and
    /// `VZVirtualMachineInstance.stop()` guards on exactly that state) — failing the gate if it does
    /// NOT throw, since that would be a genuinely different finding — and then confirms the
    /// resume-then-stop path production code will actually use succeeds cleanly.
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

        // Resume-before-stop ordering: pause again (no resume this time), then EMPIRICALLY confirm
        // stopping a still-paused container fails — this is the actual claim
        // `PausedContainerRegistry.teardown` (Task 2) and `ContainerizationControl`'s resume-failure
        // fallback (Task 5) depend on, not just asserted in a comment. A still-paused VM's
        // `VirtualMachineInstanceState` reads `.unknown` (not `.running`), and
        // `VZVirtualMachineInstance.stop()` guards on exactly that state, so `container.stop()`
        // should throw. Called directly (NOT through `stopBareContainer`, which swallows errors with
        // `try?`) so a throw is actually observed here.
        do {
            try await container.withVirtualMachineInstance { vm in try await vm.pause() }
        } catch {
            return await fail("GATE: FAIL — second vm.pause() threw: \(error)")
        }
        print("GATE: pause() succeeded (2nd time)")

        do {
            // Bounded: the Virtualization framework can hang rather than throw in some unentitled/
            // unexpected states (see `ContainerizationControl.start`'s own `racingTimeout` use for the
            // same caution) — don't let this probe block forever if a still-paused VM's guest-agent
            // vsock dial never completes.
            try await withTimeout(seconds: 15) { try await container.stop() }
            return await fail(
                "GATE: FAIL — container.stop() succeeded on a still-paused VM (expected it to throw "
                + "'vm is not running'); the resume-before-stop ordering the plan assumes does NOT "
                + "hold as predicted — this is a genuinely different finding, escalate before "
                + "continuing the suspend-on-close plan")
        } catch {
            print("GATE: container.stop() correctly threw while still paused: \(error)")
        }

        // Resume-then-stop: the pattern all production code will actually use.
        do {
            try await container.withVirtualMachineInstance { vm in try await vm.resume() }
        } catch {
            return await fail("GATE: FAIL — resume-before-stop's resume() threw: \(error)")
        }
        print("GATE: resume() succeeded (2nd time)")

        do {
            try await container.stop()
        } catch {
            return await fail(
                "GATE: FAIL — container.stop() threw after resume (expected a clean stop): \(error)")
        }
        print("GATE: container.stop() succeeded after resume")

        print("GATE: PASS")
        // `container.stop()` already succeeded above, so this repeats it — but `LinuxContainer.stop()`
        // explicitly allows being called multiple times (it returns immediately once `state ==
        // .stopped`), so this is a safe no-op for the stop call itself. Reused anyway (rather than
        // hand-duplicating its other steps) so the vmnet allocation is released and the ext4
        // rootfs/initfs artifacts are removed, matching every other exit path in this file.
        await control.stopBareContainer(container, siteID: siteID)
        return 0
    }

    /// Bounds a throwing async `operation` to `seconds`, racing it against a timeout task. Needed
    /// because the Virtualization framework backing `LinuxContainer`/`VZVirtualMachineInstance` can
    /// hang rather than throw in some unentitled/unexpected states (see
    /// `ContainerizationControl.start`'s own `racingTimeout` helper for the same caution) — this
    /// probe must not block indefinitely waiting on a call whose whole point is to observe whether
    /// it throws.
    private static func withTimeout<T: Sendable>(
        seconds: Double, operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw ContainerizationError(.timeout, message: "operation timed out after \(seconds)s")
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }

    // MARK: - boot

    /// Mirrors `ContainerizationControlTests.bootsAndServes`: full `start()` against a throwaway
    /// Astro repo (git init + one commit), bounded poll of the returned preview URL for a live
    /// HTTP response, reporting boot wall-clock. Task 5's gate — compile-checked here, not run
    /// as part of Task 4b (per the task brief).
    private static func runBoot() async -> Int32 {
        let siteID = "container-boot-probe"
        let control = ContainerizationControl()

        let repo: URL
        do {
            repo = try makeThrowawayAstroRepo()
        } catch {
            print("BOOT: FAIL — could not create throwaway Astro repo: \(error)")
            return 1
        }
        defer { try? FileManager.default.removeItem(at: repo) }

        let clock = ContinuousClock()
        let start = clock.now
        let session: LocalContainerSession
        do {
            session = try await control.start(siteID: siteID, sourceRepo: repo, ref: "HEAD", onOutput: logLine)
        } catch {
            print("BOOT: FAIL — control.start threw: \(error)")
            return 1
        }

        let ok = await pollForHTTPResponse(session.previewURL, timeout: .seconds(120))
        let elapsed = clock.now - start
        try? await control.stop(siteID: siteID)

        guard ok else {
            print("BOOT: FAIL — preview URL never answered within the timeout (elapsed \(elapsed))")
            return 1
        }

        print("BOOT: PASS (boot wall-clock: \(elapsed))")
        return 0
    }

    // MARK: - workers-dev

    /// Mirrors `ContainerizationControlTests.startsWorkersDevForActiveWorker`: boot a container,
    /// start local wrangler-dev for one active (fixture) worker, poll its URL for a live HTTP
    /// response. The #708 local-runtime feature's own decision gate.
    private static func runWorkersDev() async -> Int32 {
        let siteID = "workers-dev-probe"
        let control = ContainerizationControl()

        let repo: URL
        do {
            repo = try makeThrowawayAstroRepo()
        } catch {
            print("WORKERS-DEV: FAIL — could not create throwaway Astro repo: \(error)")
            return 1
        }
        defer { try? FileManager.default.removeItem(at: repo) }

        do {
            _ = try await control.start(siteID: siteID, sourceRepo: repo, ref: "HEAD", onOutput: logLine)
        } catch {
            print("WORKERS-DEV: FAIL — control.start threw: \(error)")
            return 1
        }

        let workers = [WorkerDescriptor(
            id: "indieauth", displayName: "IndieAuth", description: "probe fixture", group: "identity",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false))]
        let workersDevURL: URL
        do {
            workersDevURL = try await control.startWorkersDev(siteID: siteID, workers: workers, onOutput: logLine)
        } catch {
            print("WORKERS-DEV: FAIL — control.startWorkersDev threw: \(error)")
            try? await control.stop(siteID: siteID)
            return 1
        }

        let ok = await pollForHTTPResponse(workersDevURL, timeout: .seconds(60))
        try? await control.stop(siteID: siteID)

        guard ok else {
            print("WORKERS-DEV: FAIL — \(workersDevURL) never answered within the timeout")
            return 1
        }

        print("WORKERS-DEV: PASS")
        return 0
    }

    /// Polls `url` for any HTTP response (any status code is a pass — we only care that the
    /// guest dev server is accepting connections and speaking HTTP), bounded by `timeout`.
    private static func pollForHTTPResponse(_ url: URL, timeout: Duration) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            do {
                let (_, response) = try await URLSession.shared.data(from: url)
                if response is HTTPURLResponse { return true }
            } catch {
                // Not ready yet — the guest may still be installing deps / starting astro.
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        return false
    }

    /// Create a throwaway on-disk git repo containing a minimal Astro site and an initial
    /// commit. Mirrors `ContainerizationControlTests.makeThrowawayAstroRepo` — kept as a small,
    /// self-contained helper here rather than sharing code across the test target/executable
    /// boundary (SwiftPM test targets aren't importable from an executable target).
    private static func makeThrowawayAstroRepo() throws -> URL {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("anglesite-probe-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)

        try """
        {
          "name": "anglesite-probe",
          "private": true,
          "dependencies": { "astro": "*" }
        }
        """.write(to: dir.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)

        let pages = dir.appendingPathComponent("src/pages", isDirectory: true)
        try fm.createDirectory(at: pages, withIntermediateDirectories: true)
        try "<html><body><h1>Anglesite probe</h1></body></html>\n"
            .write(to: pages.appendingPathComponent("index.astro"), atomically: true, encoding: .utf8)

        func git(_ args: [String]) throws {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = args
            p.currentDirectoryURL = dir
            p.environment = ProcessInfo.processInfo.environment
                .merging(["GIT_AUTHOR_NAME": "probe", "GIT_AUTHOR_EMAIL": "probe@anglesite.test",
                          "GIT_COMMITTER_NAME": "probe", "GIT_COMMITTER_EMAIL": "probe@anglesite.test"]) { _, new in new }
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0 else {
                throw LocalContainerError.cloneFailed("git \(args.joined(separator: " ")) exited \(p.terminationStatus)")
            }
        }
        try git(["init", "-q"])
        try git(["add", "-A"])
        try git(["commit", "-q", "-m", "initial"])
        return dir
    }
}
