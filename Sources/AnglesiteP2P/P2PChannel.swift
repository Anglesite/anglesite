import Foundation

/// The four logical data channels of an Anywhere-runtime session (spec §Architecture 1).
/// Each maps 1:1 to a WebRTC data channel; the label is the channel's wire name.
public enum P2PChannelID: String, CaseIterable, Sendable {
    /// MCP JSON-RPC frames — one message per frame, no envelope.
    case mcp
    /// Fetch-bridge frames (`HTTPBridgeFrame` envelope) for preview HTTP.
    case http
    /// HMR websocket relay frames (`HMRFrame` envelope).
    case hmr
    /// Session lifecycle: heartbeat, deploy request/progress (`ControlMessage` JSON).
    case control
}

/// A connected P2P session: four message-oriented duplex channels.
///
/// Conformers: `WebRTCPeer` (production, backed by libwebrtc data channels),
/// ``InProcessP2PPair/End`` (in-process loopback, used by tests and the local demo).
public protocol P2PConnection: Sendable {
    /// Sends one message on a channel.
    ///
    /// Suspends under backpressure (a slow/full transport); throws once the connection is closed.
    ///
    /// - Parameters:
    ///   - data: The message payload, already framed per `P2PFraming` for `channel`.
    ///   - channel: Which of the four logical channels to send on.
    /// - Throws: ``P2PConnectionError/closed`` if the connection has been torn down.
    func send(_ data: Data, on channel: P2PChannelID) async throws

    /// The single inbound stream for a channel.
    ///
    /// Call once per channel per connection — this vends the channel's one `AsyncStream`, not a
    /// broadcast. The stream finishes (yields no more elements) when the connection closes.
    ///
    /// - Parameter channel: Which of the four logical channels to observe.
    /// - Returns: An `AsyncStream` of inbound message payloads for `channel`.
    func inbound(_ channel: P2PChannelID) -> AsyncStream<Data>

    /// Tears down the connection.
    ///
    /// All inbound streams finish and subsequent `send` calls throw ``P2PConnectionError/closed``.
    func close() async
}

/// Errors surfaced by ``P2PConnection`` conformers.
public enum P2PConnectionError: Error, Equatable {
    /// The connection has been closed; no further sends are possible.
    case closed
}
