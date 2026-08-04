import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct HMRRelayTests {
    // MARK: - HMR relay

    /// A scripted `WebSocketSource` that yields a fixed sequence of events, then finishes.
    private struct ScriptedSource: WebSocketSource {
        let script: [HMRFrame]

        func events() -> AsyncStream<HMRFrame> {
            AsyncStream { continuation in
                for frame in script {
                    continuation.yield(frame)
                }
                continuation.finish()
            }
        }
    }

    @Test func relayForwardsEventsInOrderEndToEnd() async throws {
        let pair = InProcessP2PPair.make()
        let script: [HMRFrame] = [.text("update"), .binary(Data([1, 2, 3])), .closed(code: 1_000)]
        let host = HMRRelayHost(connection: pair.b, source: ScriptedSource(script: script))
        let hostTask = Task { await host.run() }

        let client = HMRRelayClient(connection: pair.a)
        var it = client.events().makeAsyncIterator()

        var received: [HMRFrame] = []
        for _ in script {
            guard let frame = await it.next() else { break }
            received.append(frame)
        }

        #expect(received == script)
        hostTask.cancel()
    }

    // MARK: - Control heartbeat

    /// Thread-safe box for recording `onMiss` invocations from tests — `onMiss` is invoked from a
    /// detached `Task` off the actor (see `ControlHeartbeat`'s doc comment), so a plain captured
    /// local `var` isn't safe here.
    private final class MissCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [Int] = []

        func record(_ value: Int) {
            lock.lock()
            defer { lock.unlock() }
            values.append(value)
        }

        var latest: Int? {
            lock.lock()
            defer { lock.unlock() }
            return values.last
        }
    }

    /// Resumes a waiter once `record()` has been called `target` times. Lets a test wait for a
    /// property ("N misses have happened") instead of guessing a wall-clock delay — CI's shared
    /// runners see multi-second scheduling delays under load (observed 1.0–2.3s), so a fixed short
    /// sleep is a flake, not a bound.
    private actor MissSignal {
        private let target: Int
        private var count = 0
        private var continuation: CheckedContinuation<Void, Never>?

        init(target: Int) {
            self.target = target
        }

        func record() {
            count += 1
            guard count >= target, let continuation else { return }
            continuation.resume()
            self.continuation = nil
        }

        /// Suspends until `target` calls to `record()` have happened, or returns immediately if
        /// that already occurred. Callers race this against their own generous timeout — this
        /// method has no timeout of its own.
        func wait() async {
            guard count < target else { return }
            await withCheckedContinuation { continuation = $0 }
        }
    }

    /// Races `body` against a `timeout` sleep and returns as soon as either finishes — the
    /// event-driven counterpart to a fixed `Task.sleep`. `body` is expected to be a `MissSignal`
    /// wait (or similar); if `timeout` wins, `body`'s condition is simply left unmet and the
    /// caller's own assertion (e.g. a miss counter) reports the failure.
    private func waitUntil(timeout: Duration, _ body: @Sendable @escaping () async -> Void) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await body() }
            group.addTask { try? await Task.sleep(for: timeout) }
            await group.next()
            group.cancelAll()
        }
    }

    @Test func heartbeatAnswersInboundPingWithPong() async throws {
        let pair = InProcessP2PPair.make()
        let heartbeat = ControlHeartbeat(connection: pair.b, interval: .seconds(60), missLimit: 100) { _ in }
        let heartbeatTask = Task { await heartbeat.run() }

        var it = pair.a.inbound(.control).makeAsyncIterator()
        let pingData = try JSONEncoder().encode(ControlMessage.ping(seq: 1))
        try await pair.a.send(pingData, on: .control)

        // The heartbeat's own outbound ping could also land on this stream; skip past it to find
        // the pong that answers ours.
        var pong: ControlMessage?
        while let data = await it.next() {
            let message = try JSONDecoder().decode(ControlMessage.self, from: data)
            if case .pong(let seq) = message, seq == 1 {
                pong = message
                break
            }
        }

        #expect(pong == .pong(seq: 1))
        heartbeatTask.cancel()
    }

    @Test(.timeLimit(.minutes(1)))
    func missedPongsInvokeOnMiss() async throws {
        let pair = InProcessP2PPair.make()
        let signal = MissSignal(target: 2)

        await confirmation(expectedCount: 2...) { confirmed in
            let heartbeat = ControlHeartbeat(
                connection: pair.a,
                interval: .milliseconds(20),
                missLimit: 2
            ) { _ in
                confirmed()
                Task { await signal.record() }
            }
            // Deliberately no responder wired to `pair.b` — every ping the heartbeat sends goes
            // unanswered, so misses accumulate. Wait for the property (>= 2 misses), generously
            // bounded rather than sleeping a fixed guess — `.timeLimit` above is the hang guard
            // if this never resolves.
            let heartbeatTask = Task { await heartbeat.run() }
            await waitUntil(timeout: .seconds(30)) { await signal.wait() }
            heartbeatTask.cancel()
        }
    }

    /// Regression test for the ping loop leaking forever on a closed connection: `send()` used to
    /// swallow `P2PConnectionError.closed` internally, so `sendPings()` never noticed the
    /// connection was gone and `run()` — which awaited both loops — never returned, firing
    /// `onMiss` on every subsequent interval into a dead connection.
    @Test(.timeLimit(.minutes(1)))
    func closingConnectionStopsHeartbeatAndOnMissGrowth() async throws {
        let pair = InProcessP2PPair.make()
        let counter = MissCounter()
        let firstMiss = MissSignal(target: 1)
        let heartbeat = ControlHeartbeat(
            connection: pair.a,
            interval: .milliseconds(20),
            missLimit: 1
        ) { count in
            counter.record(count)
            Task { await firstMiss.record() }
        }
        let heartbeatTask = Task { await heartbeat.run() }

        // Deliberately no responder wired to `pair.b`. Wait for the property (the first miss
        // happened), generously bounded rather than sleeping a fixed guess — a loaded CI runner
        // can delay scheduling well past a 20ms interval (observed 1.0–2.3s in practice).
        await waitUntil(timeout: .seconds(15)) { await firstMiss.wait() }
        #expect((counter.latest ?? 0) >= 1)

        await pair.a.close()

        // `run()` must return once the connection is gone, not loop forever — bounded generously
        // (this is a liveness check, not a latency benchmark) so scheduling delays on a busy
        // runner don't turn a correctness assertion into a flaky performance one.
        let start = ContinuousClock.now
        await heartbeatTask.value
        #expect(ContinuousClock.now - start < .seconds(10))

        // Let any straggler `onMiss` `Task` already in flight at close-time finish, then confirm
        // the count stops growing — the ping loop must not keep firing into a dead connection.
        // Windows scaled up for load tolerance: this is inherently sleep-based (proving an
        // absence isn't event-driven), but generous enough not to flake under CI scheduling
        // delay while still catching a real "keeps firing forever" regression.
        try await Task.sleep(for: .milliseconds(500))
        let countAtClose = counter.latest ?? 0
        try await Task.sleep(for: .seconds(3))
        #expect(counter.latest == countAtClose)
    }

    @Test(.timeLimit(.minutes(1)))
    func cancellingTaskStopsHeartbeat() async throws {
        let pair = InProcessP2PPair.make()
        let heartbeat = ControlHeartbeat(connection: pair.a, interval: .milliseconds(20), missLimit: 1) { _ in }
        let heartbeatTask = Task { await heartbeat.run() }

        try await Task.sleep(for: .milliseconds(50))
        heartbeatTask.cancel()

        // Bounded generously (liveness, not latency) — see `closingConnectionStops...` above.
        let start = ContinuousClock.now
        await heartbeatTask.value
        #expect(ContinuousClock.now - start < .seconds(10))
    }
}
