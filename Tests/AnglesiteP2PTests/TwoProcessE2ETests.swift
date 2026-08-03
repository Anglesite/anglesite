import Testing
import Foundation

/// The Anywhere-runtime P0 exit criterion (#1208): spawns the real `anglesite-p2p-demo` binary
/// **twice**, as two independent Mac processes talking over ``FileSignalingChannel`` + a real
/// `RTCPeerConnection`, and proves a page fetch and an MCP round-trip cross the bridge between
/// them. Everything below it (`WebRTCPeer`, `FetchBridgeServer`/`FetchBridgeClient`,
/// `WebRTCTransport`/`MCPChannelResponder`) already has in-process coverage; this is the one test
/// that proves those pieces also work across a real process boundary, which is the whole point of
/// the transport.
///
/// Gated behind `ANGLESITE_P2P_E2E=1` for the same reason as `WebRTCPeerTests`: real WebRTC
/// handshakes are too slow/flaky for the default `swift test` run, but must still be run
/// explicitly before every change to this transport.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["ANGLESITE_P2P_E2E"] == "1"))
struct TwoProcessE2ETests {
    // Repo convention for a test that could hang rather than fail cleanly (a stalled handshake
    // or a process that never exits) — bounds the run instead of stalling CI/local runs
    // indefinitely. The client-side wait below uses a tighter 55 s bound so a genuine timeout
    // reports a clear, log-carrying failure instead of this trait cancelling the test task out
    // from under a still-running subprocess.
    @Test(.timeLimit(.minutes(1)))
    func twoProcessesExchangePageAndMCPRoundTrip() async throws {
        let demoBinary = try Self.locateDemoBinary()

        let signalDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("p2p-e2e-sig-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: signalDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: signalDirectory) }

        let siteDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("p2p-e2e-site-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let indexBody = "<html><body>Anywhere runtime P0 fixture \(UUID().uuidString)</body></html>"
        try indexBody.write(
            to: siteDirectory.appendingPathComponent("index.html"), atomically: true, encoding: .utf8
        )

        let host = Self.makeProcess(
            binary: demoBinary, arguments: ["host", signalDirectory.path, siteDirectory.path]
        )
        let hostCapture = ProcessOutputCapture()
        hostCapture.attach(to: host)
        try host.run()
        // Logs are sacred: always terminate the host and drain its captured output, even if an
        // assertion below throws/fails first — a leaked host process would otherwise keep
        // polling `signalDirectory` forever, and its stdout/stderr would never make it into a
        // failure message.
        defer {
            hostCapture.stop()
            if host.isRunning { host.terminate() }
            host.waitUntilExit()
        }

        let client = Self.makeProcess(binary: demoBinary, arguments: ["client", signalDirectory.path])
        let clientCapture = ProcessOutputCapture()
        clientCapture.attach(to: client)
        try client.run()

        let clientExitedInTime = await Self.waitForExit(client, timeoutSeconds: 55)
        if !clientExitedInTime, client.isRunning {
            client.terminate()
            client.waitUntilExit()
        }
        clientCapture.stop()

        let failureContext = """
        client exit=\(client.terminationStatus) timedOut=\(!clientExitedInTime)
        --- client stdout ---
        \(clientCapture.stdoutString)
        --- client stderr ---
        \(clientCapture.stderrString)
        --- host stdout (through teardown) ---
        \(hostCapture.stdoutString)
        --- host stderr (through teardown) ---
        \(hostCapture.stderrString)
        """

        #expect(clientExitedInTime, "client did not exit within 55s\n\(failureContext)")
        #expect(client.terminationStatus == 0, "client exited non-zero\n\(failureContext)")
        #expect(clientCapture.stdoutString.contains("P2P-E2E-OK"), "missing success marker\n\(failureContext)")
    }

    private static func makeProcess(binary: URL, arguments: [String]) -> Process {
        let process = Process()
        process.executableURL = binary
        process.arguments = arguments
        return process
    }

    /// Polls `process.isRunning` until it exits or `timeoutSeconds` elapses. Returns `true` if
    /// the process exited on its own within the bound. Polling (rather than a
    /// `terminationHandler` continuation) sidesteps any ordering race between registering a
    /// handler and the process already having exited.
    private static func waitForExit(_ process: Process, timeoutSeconds: Double) async -> Bool {
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while process.isRunning {
            guard Date() < deadline else { return false }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return true
    }

    /// Locates the sibling `anglesite-p2p-demo` executable next to this test bundle's own build
    /// products.
    ///
    /// `CommandLine.arguments[0]` is *not* usable here the way a plain command-line tool's would
    /// be: under `swift test`, the running process is
    /// `swiftpm-testing-helper` inside the toolchain, not anything under `.build/`. What *is*
    /// reliably present somewhere in `CommandLine.arguments` is a path through this test
    /// bundle's own `.xctest`, e.g. `.../Products/Debug/AnglesiteP2PTests.xctest/Contents/MacOS/…`
    /// (as `--test-bundle-path`'s value and again as a bare positional argument) — walking either
    /// one up to its `.xctest` component and taking that directory's parent is the build products
    /// directory, the same directory the demo executable lands in.
    private static func locateDemoBinary() throws -> URL {
        for argument in CommandLine.arguments where argument.contains(".xctest") {
            var url = URL(fileURLWithPath: argument)
            while url.pathExtension != "xctest", url.path != "/" {
                url = url.deletingLastPathComponent()
            }
            guard url.pathExtension == "xctest" else { continue }
            let candidate = url.deletingLastPathComponent().appendingPathComponent("anglesite-p2p-demo")
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        throw TwoProcessE2EError.demoBinaryNotFound(searchedArguments: CommandLine.arguments)
    }
}

/// Errors specific to ``TwoProcessE2ETests``.
private enum TwoProcessE2EError: Error, CustomStringConvertible {
    case demoBinaryNotFound(searchedArguments: [String])

    var description: String {
        switch self {
        case .demoBinaryNotFound(let arguments):
            return "could not locate anglesite-p2p-demo next to the test bundle's build products "
                + "(searched CommandLine.arguments: \(arguments)) — did `swift build` run first?"
        }
    }
}

/// Continuously drains a spawned process's stdout/stderr into thread-safe buffers via
/// `FileHandle.readabilityHandler`, so a long-running process (the host here, which only exits
/// once the client's `close()` sends `.bye`) never blocks on a full pipe buffer, and its output
/// captured so far is available for a failure message even before the process exits.
///
/// `@unchecked Sendable`: all mutable state is guarded by `lock`, mirroring
/// `WebRTCPeer.InboundChannelBox`'s same rationale.
private final class ProcessOutputCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var stdoutData = Data()
    private var stderrData = Data()
    private let stdoutPipe = Pipe()
    private let stderrPipe = Pipe()

    func attach(to process: Process) {
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty, let self else { return }
            self.lock.lock()
            self.stdoutData.append(chunk)
            self.lock.unlock()
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty, let self else { return }
            self.lock.lock()
            self.stderrData.append(chunk)
            self.lock.unlock()
        }
    }

    /// Detaches the readability handlers. Call once the owning process has exited so no further
    /// callback races with reading the final buffered strings below.
    func stop() {
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil
    }

    var stdoutString: String {
        lock.lock()
        defer { lock.unlock() }
        return String(data: stdoutData, encoding: .utf8) ?? "<non-UTF8 stdout: \(stdoutData.count) bytes>"
    }

    var stderrString: String {
        lock.lock()
        defer { lock.unlock() }
        return String(data: stderrData, encoding: .utf8) ?? "<non-UTF8 stderr: \(stderrData.count) bytes>"
    }
}
