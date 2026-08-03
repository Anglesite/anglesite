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
}
