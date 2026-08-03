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
