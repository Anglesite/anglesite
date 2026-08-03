import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct InProcessP2PPairTests {
    @Test func messagesCrossPerChannelInOrder() async throws {
        let pair = InProcessP2PPair.make()
        let inbound = pair.b.inbound(.mcp)
        try await pair.a.send(Data("one".utf8), on: .mcp)
        try await pair.a.send(Data("two".utf8), on: .mcp)
        var it = inbound.makeAsyncIterator()
        #expect(await it.next() == Data("one".utf8))
        #expect(await it.next() == Data("two".utf8))
    }

    @Test func channelsAreIsolated() async throws {
        let pair = InProcessP2PPair.make()
        let http = pair.b.inbound(.http)
        try await pair.a.send(Data("mcp".utf8), on: .mcp)
        try await pair.a.send(Data("http".utf8), on: .http)
        var it = http.makeAsyncIterator()
        #expect(await it.next() == Data("http".utf8))
    }

    @Test func closeFinishesInboundAndFailsSend() async throws {
        let pair = InProcessP2PPair.make()
        let inbound = pair.b.inbound(.control)
        await pair.a.close()
        var it = inbound.makeAsyncIterator()
        #expect(await it.next() == nil)
        await #expect(throws: P2PConnectionError.closed) {
            try await pair.b.send(Data(), on: .control)
        }
    }

    /// `inbound(_:)` is documented as "call once per channel" — calling it again must not split
    /// delivery into two independent copies of the stream. Both handles share one backing stream
    /// (per `channelPair(for:)`'s cache), so messages are consumed once, in order, across
    /// whichever iterator asks next — not broadcast to both.
    @Test func repeatedInboundSharesOneBackingStream() async throws {
        let pair = InProcessP2PPair.make()
        let stream1 = pair.b.inbound(.mcp)
        let stream2 = pair.b.inbound(.mcp)
        try await pair.a.send(Data("one".utf8), on: .mcp)
        try await pair.a.send(Data("two".utf8), on: .mcp)
        var it1 = stream1.makeAsyncIterator()
        var it2 = stream2.makeAsyncIterator()
        #expect(await it1.next() == Data("one".utf8))
        #expect(await it2.next() == Data("two".utf8))
    }

    /// Racing `close()` on one end against a burst of concurrent `send()`s from the other must
    /// never trap and never yield-after-finish. The invariant is per-send, not a specific count:
    /// each send either completes (possibly silently dropped mid-teardown, per `send`'s doc
    /// comment) or throws `P2PConnectionError.closed` — nothing else.
    @Test func closeDuringConcurrentSendsNeverTraps() async throws {
        let pair = InProcessP2PPair.make()

        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                await pair.a.close()
            }
            for i in 0..<50 {
                group.addTask {
                    do {
                        try await pair.b.send(Data([UInt8(i % 256)]), on: .control)
                    } catch P2PConnectionError.closed {
                        // Expected once teardown wins the race — not a failure.
                    }
                }
            }
            try await group.waitForAll()
        }

        // Both ends are now definitively closed.
        await #expect(throws: P2PConnectionError.closed) {
            try await pair.a.send(Data(), on: .control)
        }
        await #expect(throws: P2PConnectionError.closed) {
            try await pair.b.send(Data(), on: .control)
        }
    }
}
