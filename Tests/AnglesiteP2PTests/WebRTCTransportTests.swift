import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteP2P

@Suite struct WebRTCTransportTests {
    @Test func requestCrossesBridgeAndResponseReturns() async throws {
        let pair = InProcessP2PPair.make()
        let responder = MCPChannelResponder(connection: pair.b) { message in
            guard case let .object(fields) = message, fields["id"] != nil else { return nil }
            return .object(["jsonrpc": .string("2.0"), "id": fields["id"]!, "result": .object(["ok": .bool(true)])])
        }
        let serverTask = Task { await responder.run() }
        let transport = WebRTCTransport(connection: pair.a)
        try await transport.open()
        let inbound = transport.inbound()
        try await transport.send(.object(["jsonrpc": .string("2.0"), "id": .int(1), "method": .string("initialize")]))
        var it = inbound.makeAsyncIterator()
        let reply = await it.next()
        guard case let .object(fields)? = reply else { Issue.record("no reply"); return }
        #expect(fields["result"] == .object(["ok": .bool(true)]))
        serverTask.cancel()
    }

    @Test func notificationGetsNoReply() async throws {
        let pair = InProcessP2PPair.make()
        let responder = MCPChannelResponder(connection: pair.b) { _ in nil }
        let serverTask = Task { await responder.run() }
        let transport = WebRTCTransport(connection: pair.a)
        try await transport.send(.object(["jsonrpc": .string("2.0"), "method": .string("notifications/x")]))
        // Close the far end; the transport's inbound stream must finish without emitting.
        await pair.b.close()
        var it = transport.inbound().makeAsyncIterator()
        #expect(await it.next() == nil)
        serverTask.cancel()
    }

    /// `close()` must finish only this transport's own stream, never the shared `P2PConnection` —
    /// three other channels (`http`, `hmr`, `control`) depend on it staying up.
    @Test func closeFinishesOwnStreamButLeavesConnectionShared() async throws {
        let pair = InProcessP2PPair.make()
        let transport = WebRTCTransport(connection: pair.a)
        let inbound = transport.inbound()

        await transport.close()
        var it = inbound.makeAsyncIterator()
        #expect(await it.next() == nil)

        // The underlying connection must still carry traffic on another channel.
        let controlInbound = pair.b.inbound(.control)
        try await pair.a.send(Data("still-alive".utf8), on: .control)
        var controlIt = controlInbound.makeAsyncIterator()
        #expect(await controlIt.next() == Data("still-alive".utf8))
    }

    /// An undecodable frame on the `mcp` channel must be logged and skipped, never stall the
    /// pump — the next well-formed message still has to arrive.
    @Test func undecodableInboundFrameIsSkippedNotStalled() async throws {
        let pair = InProcessP2PPair.make()
        let transport = WebRTCTransport(connection: pair.a)
        let peerTransport = WebRTCTransport(connection: pair.b)
        var it = transport.inbound().makeAsyncIterator()

        try await pair.b.send(Data([0xFF, 0x00, 0x01]), on: .mcp)
        let wellFormed: JSONValue = .object(["jsonrpc": .string("2.0"), "id": .int(7), "method": .string("ping")])
        try await peerTransport.send(wellFormed)
        #expect(await it.next() == wellFormed)
    }

    /// Same skip-not-stall guarantee on the host side: `MCPChannelResponder.run()` must not wedge
    /// on a garbage frame and must still answer the next well-formed request.
    @Test func responderSkipsUndecodableFrameThenAnswersNextRequest() async throws {
        let pair = InProcessP2PPair.make()
        let responder = MCPChannelResponder(connection: pair.b) { message in
            guard case let .object(fields) = message, fields["id"] != nil else { return nil }
            return .object(["jsonrpc": .string("2.0"), "id": fields["id"]!, "result": .object(["ok": .bool(true)])])
        }
        let serverTask = Task { await responder.run() }
        let transport = WebRTCTransport(connection: pair.a)
        var it = transport.inbound().makeAsyncIterator()

        try await pair.a.send(Data([0xFF, 0x00, 0x01]), on: .mcp)
        try await transport.send(.object(["jsonrpc": .string("2.0"), "id": .int(9), "method": .string("initialize")]))
        let reply = await it.next()
        guard case let .object(fields)? = reply else { Issue.record("no reply"); return }
        #expect(fields["result"] == .object(["ok": .bool(true)]))
        serverTask.cancel()
    }
}
