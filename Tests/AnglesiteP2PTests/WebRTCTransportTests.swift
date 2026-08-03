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
}
