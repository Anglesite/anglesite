import Foundation
import OSLog
import AnglesiteCore

/// Host-side counterpart to ``WebRTCTransport``: decodes each inbound `mcp` frame, invokes
/// `handler`, and sends the non-nil result back on the same channel.
///
/// P1 supplies the production handler that bridges to the container's MCP endpoint; P0 exercises
/// this with stubs (see `WebRTCTransportTests`).
public actor MCPChannelResponder {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "MCPChannelResponder")

    /// Handles one decoded inbound JSON-RPC message. Returning `nil` sends no reply — the case for
    /// notifications, which have no response by definition.
    public typealias Handler = @Sendable (JSONValue) async -> JSONValue?

    private let connection: any P2PConnection
    private let handler: Handler

    /// - Parameters:
    ///   - connection: The shared connection; ``run()`` consumes only its ``P2PChannelID/mcp``
    ///     channel, leaving the other three untouched.
    ///   - handler: Invoked once per decoded inbound message.
    public init(connection: any P2PConnection, handler: @escaping Handler) {
        self.connection = connection
        self.handler = handler
    }

    /// Consumes `connection.inbound(.mcp)` until it finishes (the connection closed). Each frame
    /// is decoded, passed to `handler`, and any non-nil result is encoded and sent back. A frame
    /// that fails to decode is logged and skipped — never silently dropped, never fatal.
    public func run() async {
        for await frame in connection.inbound(.mcp) {
            let raw: Any
            do {
                raw = try JSONSerialization.jsonObject(with: frame)
            } catch {
                Self.logger.error("dropping undecodable inbound mcp frame (\(frame.count, privacy: .public) bytes): \(String(describing: error), privacy: .public)")
                continue
            }
            guard let message = JSONValue.from(raw) else {
                Self.logger.error("dropping inbound mcp frame with unsupported JSON shape (\(frame.count, privacy: .public) bytes)")
                continue
            }
            guard let reply = await handler(message) else { continue }
            do {
                let data = try JSONSerialization.data(withJSONObject: reply.rawValue, options: [])
                try await connection.send(data, on: .mcp)
            } catch {
                Self.logger.error("failed to send mcp reply: \(error.localizedDescription, privacy: .public)")
            }
        }
    }
}
