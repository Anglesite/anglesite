import Foundation
import OSLog
import AnglesiteCore

/// Client-side ``MCPTransport``: one JSON-RPC message per data-channel frame on the
/// ``P2PChannelID/mcp`` channel of a shared ``P2PConnection``.
///
/// The connection is created once per session and shared across all four logical channels (spec
/// §Architecture 1), so this transport never owns it: ``close()`` finishes only this transport's
/// own inbound stream and pump task, never the underlying connection.
public actor WebRTCTransport: MCPTransport {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "WebRTCTransport")

    private let connection: any P2PConnection
    private let stream: AsyncStream<JSONValue>
    private let continuation: AsyncStream<JSONValue>.Continuation
    private var pumpTask: Task<Void, Never>?

    /// Wraps an already-connected ``P2PConnection``. The pump that decodes inbound `mcp` frames
    /// into JSON-RPC messages starts immediately, so nothing sent before the first ``inbound()``
    /// call is missed.
    public init(connection: any P2PConnection) {
        self.connection = connection
        (self.stream, self.continuation) = AsyncStream<JSONValue>.makeStream(bufferingPolicy: .unbounded)
        let inboundFrames = connection.inbound(.mcp)
        let continuation = self.continuation
        self.pumpTask = Task {
            for await frame in inboundFrames {
                guard let raw = try? JSONSerialization.jsonObject(with: frame),
                      let value = JSONValue.from(raw) else {
                    Self.logger.error("dropping undecodable inbound mcp frame (\(frame.count, privacy: .public) bytes)")
                    continue
                }
                continuation.yield(value)
            }
            continuation.finish()
        }
    }

    /// No-op: the ``P2PConnection`` is already established by the time this transport is
    /// constructed. Exists only to satisfy `MCPTransport`.
    public func open() async throws { /* the connection pre-exists */ }

    /// Encodes `message` with the same `JSONSerialization` round-trip `HTTPTransport` uses and
    /// sends it as one frame on the `mcp` channel.
    public func send(_ message: JSONValue) async throws {
        let data = try JSONSerialization.data(withJSONObject: message.rawValue, options: [])
        try await connection.send(data, on: .mcp)
    }

    /// The single stream of decoded inbound JSON-RPC messages, fed by the pump task started in
    /// `init`. `nonisolated` (the stream is a `let` fixed at construction) so a caller can start
    /// consuming without an actor hop.
    public nonisolated func inbound() -> AsyncStream<JSONValue> { stream }

    /// Finishes this transport's own inbound stream and cancels its pump task. Deliberately does
    /// **not** close `connection` — three other channels (`http`, `hmr`, `control`) share it.
    public func close() async {
        pumpTask?.cancel()
        pumpTask = nil
        continuation.finish()
    }
}
