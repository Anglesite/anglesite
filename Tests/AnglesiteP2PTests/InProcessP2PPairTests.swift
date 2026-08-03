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
}
