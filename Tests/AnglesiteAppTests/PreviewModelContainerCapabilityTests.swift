import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

/// A minimal `LocalContainerControl` stub — just enough to prove `PreviewModel` reaches it
/// through `containerCapability` rather than downcasting to the concrete `LocalContainerSiteRuntime`
/// type it used to require.
private actor StubLocalContainerControl: LocalContainerControl {
    private(set) var resetNetworkingCallCount = 0

    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        LocalContainerSession(
            previewURL: URL(string: "http://127.0.0.1:1")!,
            mcpURL: URL(string: "http://127.0.0.1:2")!)
    }

    func stop(siteID: String) async throws {}

    func startWorkersDev(
        siteID: String, workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:3")!
    }

    func stopWorkersDev(siteID: String) async throws {}

    func exec(
        siteID: String, argv: [String], environment: [String: String], workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        ContainerExecResult(exitCode: 0, stdout: "", stderr: "")
    }

    func execInteractive(
        siteID: String, argv: [String], environment: [String: String], workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        InteractiveExecHandle(write: { _ in }, terminate: {})
    }

    func resetNetworking() async { resetNetworkingCallCount += 1 }
}

/// A `SiteRuntime` test double that is deliberately NOT `LocalContainerSiteRuntime` — it proves
/// `PreviewModel.activeContainerControl()`/`resetNetworking()` reach container-only members via
/// `containerCapability` (#823), not an `as? LocalContainerSiteRuntime` downcast that would
/// silently return nil/no-op for any conformer other than that one concrete class.
private actor FakeContainerCapableSiteRuntime: SiteRuntime, SiteRuntimeContainerCapability {
    let mcpClient = MCPClient(supervisor: ProcessSupervisor(), logCenter: LogCenter())
    private let control = StubLocalContainerControl()
    private var started: String?
    private(set) var persistedCommits: [String] = []

    nonisolated var containerCapability: (any SiteRuntimeContainerCapability)? { self }

    func start(siteID: String, siteDirectory: URL) async { started = siteID }
    func stop() async { started = nil }
    func observe() -> AsyncStream<SiteRuntimeState> { AsyncStream<SiteRuntimeState> { _ in } }

    func containerSnapshot() async -> (control: any LocalContainerControl, siteID: String)? {
        guard let started else { return nil }
        return (control: control, siteID: started)
    }

    func resetNetworking() async { await control.resetNetworking() }

    func persistEdit(commit: String?) async throws {
        guard let commit else { return }
        persistedCommits.append(commit)
    }

    private(set) var updatedActiveWorkerSettings: [SiteSettings] = []

    func updateActiveWorkers(_ settings: SiteSettings) async {
        updatedActiveWorkerSettings.append(settings)
    }

    func resetNetworkingCallCount() async -> Int { await control.resetNetworkingCallCount }
}

@Suite("PreviewModel containerCapability (#823)")
@MainActor
struct PreviewModelContainerCapabilityTests {
    @Test("activeContainerControl() reaches a non-LocalContainerSiteRuntime conformer's capability")
    func activeContainerControlReachesCustomConformer() async {
        let runtime = FakeContainerCapableSiteRuntime()
        let model = PreviewModel(runtime: runtime)

        let beforeStart = await model.activeContainerControl()
        #expect(beforeStart == nil)

        await runtime.start(siteID: "custom-site", siteDirectory: URL(fileURLWithPath: "/unused"))
        let afterStart = await model.activeContainerControl()
        #expect(afterStart?.siteID == "custom-site")

        await runtime.stop()
        let afterStop = await model.activeContainerControl()
        #expect(afterStop == nil)
    }

    @Test("resetNetworking() reaches a non-LocalContainerSiteRuntime conformer's control")
    func resetNetworkingReachesCustomConformer() async {
        let runtime = FakeContainerCapableSiteRuntime()
        let model = PreviewModel(runtime: runtime)

        await model.resetNetworking()

        #expect(await runtime.resetNetworkingCallCount() == 1)
    }

    @Test("activeWorkersChanged reaches the runtime through containerCapability")
    func activeWorkersChangedReachesCapability() async {
        let runtime = FakeContainerCapableSiteRuntime()
        let model = PreviewModel(runtime: runtime)

        var settings = SiteSettings()
        settings.activeWorkerIDs = ["solid-pod"]
        await model.activeWorkersChanged(settings)

        #expect(await runtime.updatedActiveWorkerSettings == [settings])
    }

    @Test("activeContainerControl() and resetNetworking() are no-ops for a runtime with no container capability")
    func noOpsForNonCapableRuntime() async {
        let model = PreviewModel(runtime: UnavailableSiteRuntime(reason: "no container capability"))

        let control = await model.activeContainerControl()
        #expect(control == nil)

        // Must not crash or hang — there's simply nothing to reach.
        await model.resetNetworking()
    }
}
