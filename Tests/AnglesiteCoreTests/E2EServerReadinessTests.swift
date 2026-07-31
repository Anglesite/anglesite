import Testing
import Foundation
@testable import AnglesiteCore
import AnglesiteTestSupport

/// Unit coverage for `E2EServer.awaitReady` — the death-detecting startup wait shared by the MCP
/// end-to-end tests. These use throwaway `/bin/sh` processes (no plugin / Node needed) so they run
/// everywhere, unlike the gated e2e tests they harden.
@Suite(.serialized)
struct E2EServerReadinessTests {
    @Test("awaitReady fails fast with captured stderr when the server dies before readiness")
    func deathSurfacesStderr() async throws {
        let supervisor = ProcessSupervisor()
        let logCenter = LogCenter()
        let marker = "BOOT_CRASH_\(UUID().uuidString)"
        let handle = try await supervisor.launch(
            source: "e2e-readiness-death",
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "echo \(marker) 1>&2; exit 7"],
            restartPolicy: .never,
            logCenter: logCenter
        )

        do {
            try await E2EServer.awaitReady(
                handle: handle,
                supervisor: supervisor,
                logCenter: logCenter,
                timeout: 20
            ) {
                // Readiness never succeeds — mimics polling a server that will never start listening.
                while true { try await Task.sleep(nanoseconds: 50_000_000) }
            }
            Issue.record("expected awaitReady to throw ServerExited, but it returned")
        } catch let error as E2EServer.ServerExited {
            #expect(error.stderr.contains(marker), "stderr should surface the real crash output")
            #expect(error.reason == .exited(code: 7))
        } catch let error as E2EServer.ServerTimedOut {
            // A 20s timeout budget alongside readiness that never completes means the only other
            // possible outcome is waiting out the full budget instead of detecting the death — the
            // failure mode this test guards against. Asserting the error type (rather than elapsed
            // wall-clock time) proves the fast path won without being sensitive to runner load.
            Issue.record("expected ServerExited from process death, but timed out waiting for readiness: \(error)")
        }
    }

    @Test("awaitReady returns cleanly when readiness wins against a still-alive server")
    func readinessWinsWithoutFalseDeath() async throws {
        let supervisor = ProcessSupervisor()
        let logCenter = LogCenter()
        // Long-lived process: it must NOT exit while readiness completes, so the death branch
        // stays parked and the only finisher is `readiness`.
        let handle = try await supervisor.launch(
            source: "e2e-readiness-alive",
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "sleep 30"],
            restartPolicy: .never,
            logCenter: logCenter
        )
        defer { Task { await supervisor.terminate(handle, timeout: 2) } }

        // Should return normally — cancelling the parked death-waiter must not surface as a crash.
        try await E2EServer.awaitReady(
            handle: handle,
            supervisor: supervisor,
            logCenter: logCenter,
            timeout: 20
        ) {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    @Test("awaitReady reports a budget overrun as ServerTimedOut, not a phantom crash")
    func timeoutIsDistinctFromCrash() async throws {
        let supervisor = ProcessSupervisor()
        let logCenter = LogCenter()
        // A healthy-but-slow server: the process stays alive (so the death branch never fires), but
        // readiness never completes, so only the timeout can settle the outcome.
        let handle = try await supervisor.launch(
            source: "e2e-readiness-timeout",
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "sleep 30"],
            restartPolicy: .never,
            logCenter: logCenter
        )
        defer { Task { await supervisor.terminate(handle, timeout: 2) } }

        let start = Date()
        do {
            try await E2EServer.awaitReady(
                handle: handle,
                supervisor: supervisor,
                logCenter: logCenter,
                timeout: 0.3
            ) {
                while true { try await Task.sleep(nanoseconds: 50_000_000) }
            }
            Issue.record("expected awaitReady to throw ServerTimedOut, but it returned")
        } catch let error as E2EServer.ServerTimedOut {
            #expect(error.timeout == 0.3)
        } catch let error as E2EServer.ServerExited {
            Issue.record("a live-but-slow server must time out, not be reported as exited: \(error)")
        }
        // The budget, not the 30s process lifetime, bounds the wait.
        #expect(Date().timeIntervalSince(start) < 5)
    }
}
