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

    @Test func missedPongsInvokeOnMiss() async throws {
        let pair = InProcessP2PPair.make()

        await confirmation(expectedCount: 2...) { confirmed in
            let heartbeat = ControlHeartbeat(
                connection: pair.a,
                interval: .milliseconds(20),
                missLimit: 2
            ) { _ in
                confirmed()
            }
            // Deliberately no responder wired to `pair.b` — every ping the heartbeat sends goes
            // unanswered, so misses accumulate.
            let heartbeatTask = Task { await heartbeat.run() }
            try? await Task.sleep(for: .milliseconds(500))
            heartbeatTask.cancel()
        }
    }

    /// Regression test for the ping loop leaking forever on a closed connection: `send()` used to
    /// swallow `P2PConnectionError.closed` internally, so `sendPings()` never noticed the
    /// connection was gone and `run()` — which awaited both loops — never returned, firing
    /// `onMiss` on every subsequent interval into a dead connection.
    @Test func closingConnectionStopsHeartbeatAndOnMissGrowth() async throws {
        let pair = InProcessP2PPair.make()
        let counter = MissCounter()
        let heartbeat = ControlHeartbeat(
            connection: pair.a,
            interval: .milliseconds(20),
            missLimit: 1
        ) { count in
            counter.record(count)
        }
        let heartbeatTask = Task { await heartbeat.run() }

        // Deliberately no responder wired to `pair.b` — let a few misses accumulate first.
        try await Task.sleep(for: .milliseconds(100))
        #expect((counter.latest ?? 0) >= 1)

        await pair.a.close()

        // `run()` must return in bounded time once the connection is gone, not loop forever.
        let start = ContinuousClock.now
        await heartbeatTask.value
        #expect(ContinuousClock.now - start < .milliseconds(200))

        // Let any straggler `onMiss` `Task` already in flight at close-time finish, then confirm
        // the count stops growing — the ping loop must not keep firing into a dead connection.
        try await Task.sleep(for: .milliseconds(50))
        let countAtClose = counter.latest ?? 0
        try await Task.sleep(for: .milliseconds(150))
        #expect(counter.latest == countAtClose)
    }

    @Test func cancellingTaskStopsHeartbeat() async throws {
        let pair = InProcessP2PPair.make()
        let heartbeat = ControlHeartbeat(connection: pair.a, interval: .milliseconds(20), missLimit: 1) { _ in }
        let heartbeatTask = Task { await heartbeat.run() }

        try await Task.sleep(for: .milliseconds(50))
        heartbeatTask.cancel()

        let start = ContinuousClock.now
        await heartbeatTask.value
        #expect(ContinuousClock.now - start < .milliseconds(200))
    }
}
