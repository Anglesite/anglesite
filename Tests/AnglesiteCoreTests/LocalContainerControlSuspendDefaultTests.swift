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
