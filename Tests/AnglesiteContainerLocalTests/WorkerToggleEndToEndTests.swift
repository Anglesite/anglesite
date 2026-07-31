import Testing
import Foundation
import AnglesiteContainer
import AnglesiteCore

/// Local-only, entitlement-gated e2e test for the toggle→restart path a future Workers tab
/// (#917) drives through `SiteRuntimeContainerCapability.updateActiveWorkers`. Owed from the
/// #700 design doc §9 and #917 (#919): unit tests in `LocalContainerSiteRuntimeTests` cover the
/// plumbing against a `FakeLocalContainerControl`, but nothing e2e-verifies that toggling a
/// settings-activated worker on/off actually restarts/stops local `wrangler dev` inside a real
/// booted container.
///
/// This whole *target* is excluded from CI's `swift test` (it's appended to `packageTargets` in
/// Package.swift only when `ANGLESITE_CONTAINER_TESTS=1`), and this test body additionally
/// requires `ANGLESITE_CONTAINER_E2E=1` so it is skipped unless explicitly run on an entitled
/// Apple-Silicon Mac with the vendored boot artifacts present (mirrors
/// `ContainerizationControlTests`'s gating).
struct WorkerToggleEndToEndTests {
    private var enabled: Bool { ProcessInfo.processInfo.environment["ANGLESITE_CONTAINER_E2E"] == "1" }

    /// The single settings-activated fixture worker used throughout the suite (mirrors
    /// `LocalContainerSiteRuntimeTests`'s "indieauth" fixture and the `workers-dev` probe's own).
    private static let indieAuthCatalog: [WorkerDescriptor] = [
        WorkerDescriptor(
            id: "indieauth", displayName: "IndieAuth", description: "e2e fixture", group: "identity",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false))
    ]

    @Test("updateActiveWorkers toggles local wrangler-dev on and off for a running container")
    func toggleRestartsLocalWranglerDev() async throws {
        try #require(enabled, "set ANGLESITE_CONTAINER_E2E=1 on an entitled Apple-Silicon Mac")

        let siteID = "worker-toggle-e2e"
        let package = try makeThrowawayPackage()
        defer { try? FileManager.default.removeItem(at: package) }

        let configStore = SiteConfigStore(configDirectory: AnglesitePackage(url: package).configURL)
        // Empty active-worker set at boot time, matching #919 step 1 ("boots a site with an empty
        // active-worker set (no workersDevURL in the ready state)").
        try await configStore.save(SiteSettings())

        let control = ContainerizationControl()
        let runtime = LocalContainerSiteRuntime(
            ref: "HEAD",
            control: control,
            mcpClient: MCPClient(supervisor: .shared),
            workerCatalog: { Self.indieAuthCatalog })
        // Safety net: fires on any exit path (incl. a thrown #expect below) so a failed
        // assertion doesn't leave the VM running. stop() is idempotent, so the awaited
        // happy-path stop below is harmless after this.
        defer { Task { await runtime.stop() } }

        await runtime.start(siteID: siteID, siteDirectory: AnglesitePackage(url: package).sourceURL)

        guard case .ready(_, _, let bootWorkersDevURL) = await runtime.state else {
            Issue.record("expected .ready after boot, got \(await runtime.state)")
            return
        }
        #expect(bootWorkersDevURL == nil, "no active workers were configured at boot")

        // Step 2/3: activate the fixture worker via Settings and drive the toggle through
        // updateActiveWorkers (the Workers tab's own call path) — assert the state re-settles to
        // .ready with a non-nil workersDevURL and the local worker URL becomes reachable.
        let activated = SiteSettings(activeWorkerIDs: ["indieauth"])
        try await configStore.save(activated)
        await runtime.updateActiveWorkers(activated)

        guard case .ready(_, _, let activeWorkersDevURL) = await runtime.state else {
            Issue.record("expected .ready after activating a worker, got \(await runtime.state)")
            return
        }
        let workersDevURL = try #require(activeWorkersDevURL, "activating a worker should populate workersDevURL")

        let reachable = await pollForHTTPResponse(workersDevURL, timeout: .seconds(60))
        #expect(reachable, "local wrangler-dev never answered within the timeout after the toggle-on")

        // Step 4: toggle back off and assert wrangler-dev stops (workersDevURL returns to nil).
        let deactivated = SiteSettings()
        try await configStore.save(deactivated)
        await runtime.updateActiveWorkers(deactivated)

        guard case .ready(_, _, let stoppedWorkersDevURL) = await runtime.state else {
            Issue.record("expected .ready after deactivating the worker, got \(await runtime.state)")
            return
        }
        #expect(stoppedWorkersDevURL == nil, "deactivating the worker should clear workersDevURL")

        await runtime.stop()
    }

    /// Polls `url` for any HTTP response (any status code is a pass — we only care that the local
    /// wrangler-dev endpoint is accepting connections and speaking HTTP), bounded by `timeout`.
    /// Mirrors `ContainerizationControlTests.pollForHTTPResponse` — kept as a small,
    /// self-contained duplicate here per that file's own precedent (no shared test-support target
    /// for this local-only suite).
    private func pollForHTTPResponse(_ url: URL, timeout: Duration) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            do {
                let (_, response) = try await URLSession.shared.data(from: url)
                if response is HTTPURLResponse { return true }
            } catch {
                // Not ready yet — wrangler-dev may still be starting up inside the guest.
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        return false
    }

    /// Creates a throwaway `.anglesite` package: `Source/` holds a minimal Astro project with an
    /// initial git commit (the `file://` repo `LocalContainerSiteRuntime.start` clones into the
    /// guest), `Config/` is where `SiteConfigStore` persists the active-worker settings
    /// `updateActiveWorkers`'s `startWorkersDevIfActive` re-reads from disk. Mirrors
    /// `ContainerizationControlTests.makeThrowawayAstroRepo` plus
    /// `LocalContainerSiteRuntimeTests.temporaryPackage`, combined since this suite needs both a
    /// real bootable repo and a real on-disk settings store.
    private func makeThrowawayPackage() throws -> URL {
        let fm = FileManager.default
        let package = fm.temporaryDirectory
            .appendingPathComponent("WorkerToggleEndToEndTests-\(UUID().uuidString).anglesite", isDirectory: true)
        let sourceURL = AnglesitePackage(url: package).sourceURL
        try fm.createDirectory(at: sourceURL, withIntermediateDirectories: true)
        try fm.createDirectory(at: AnglesitePackage(url: package).configURL, withIntermediateDirectories: true)

        try """
        {
          "name": "anglesite-worker-toggle-e2e",
          "private": true,
          "dependencies": { "astro": "*" }
        }
        """.write(to: sourceURL.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)

        let pages = sourceURL.appendingPathComponent("src/pages", isDirectory: true)
        try fm.createDirectory(at: pages, withIntermediateDirectories: true)
        try "<html><body><h1>Anglesite worker-toggle e2e</h1></body></html>\n"
            .write(to: pages.appendingPathComponent("index.astro"), atomically: true, encoding: .utf8)

        func git(_ args: [String]) throws {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = args
            p.currentDirectoryURL = sourceURL
            p.environment = ProcessInfo.processInfo.environment
                .merging(["GIT_AUTHOR_NAME": "e2e", "GIT_AUTHOR_EMAIL": "e2e@anglesite.test",
                          "GIT_COMMITTER_NAME": "e2e", "GIT_COMMITTER_EMAIL": "e2e@anglesite.test"]) { _, new in new }
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0 else {
                throw LocalContainerError.cloneFailed("git \(args.joined(separator: " ")) exited \(p.terminationStatus)")
            }
        }
        try git(["init", "-q"])
        try git(["add", "-A"])
        try git(["commit", "-q", "-m", "initial"])
        return package
    }
}
