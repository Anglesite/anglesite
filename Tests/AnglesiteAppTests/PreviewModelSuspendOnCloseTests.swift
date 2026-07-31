import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

/// Records whether `stop()` or `suspend()` was called, without doing anything else — isolates
/// exactly the one behavior this test needs to prove: `PreviewModel.close()` must call `suspend()`,
/// not `stop()`, so a closed-then-reopened site window can resume instead of cold-booting.
private actor SpySiteRuntime: SiteRuntime {
    private(set) var stopCalls = 0
    private(set) var suspendCalls = 0
    let mcpClient = MCPClient(supervisor: ProcessSupervisor(), logCenter: LogCenter())
    private let (stream, continuation) = AsyncStream<SiteRuntimeState>.makeStream()

    func start(siteID: String, siteDirectory: URL) async {
        continuation.yield(.ready(siteID: siteID, url: URL(string: "http://127.0.0.1:1")!, workersDevURL: nil))
    }
    func stop() async { stopCalls += 1 }
    func suspend() async { suspendCalls += 1 }
    func observe() -> AsyncStream<SiteRuntimeState> { stream }
}

@Suite("PreviewModel suspend-on-close")
@MainActor
struct PreviewModelSuspendOnCloseTests {
    @Test
    func closeSuspendsRatherThanStops() async throws {
        let runtime = SpySiteRuntime()
        let model = PreviewModel(runtime: runtime)
        let root = URL(fileURLWithPath: "/tmp/suspend-on-close-test")
        model.open(site: CurrentSite(id: "site-1", packageURL: root, sourceDirectory: root))
        try await Task.sleep(for: .milliseconds(50))  // open() dispatches its boot in a Task

        model.close()
        try await Task.sleep(for: .milliseconds(50))  // close() dispatches its teardown in a Task

        #expect(await runtime.suspendCalls == 1)
        #expect(await runtime.stopCalls == 0)
    }
}
