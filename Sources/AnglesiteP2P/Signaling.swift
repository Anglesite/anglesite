import Foundation

/// One signaling message exchanged out-of-band to establish a ``P2PConnection`` (spec
/// §Architecture 3). P2 adds signatures/key-pinning around this envelope; P0 carries it in the
/// clear (file signaling is local-only dev/test infra).
public struct SignalingEnvelope: Codable, Sendable, Equatable {
    /// Monotonically increasing per-sender counter, starting at 1. ``SignalingChannel``
    /// conformers use this to deliver envelopes from a given sender in order.
    public var seq: Int
    /// Stable per-endpoint id, e.g. `"host"` / `"client"` or `"offerer"` / `"answerer"`.
    public var sender: String
    /// Which handshake step this envelope carries; determines how `payload` is interpreted.
    public var kind: Kind
    /// SDP text (`.offer`/`.answer`), an ICE candidate encoded as JSON (`.candidate`), or empty
    /// (`.bye`).
    public var payload: String

    /// One step of the offer/answer + trickle-ICE handshake ``WebRTCPeer`` drives over a
    /// ``SignalingChannel``.
    public enum Kind: String, Codable, Sendable {
        /// The offerer's initial SDP offer, carried in `payload`.
        case offer
        /// The answerer's SDP answer to a received `.offer`, carried in `payload`.
        case answer
        /// One trickled ICE candidate, JSON-encoded in `payload`.
        case candidate
        /// Clean session teardown; `payload` is empty.
        case bye
    }

    public init(seq: Int, sender: String, kind: Kind, payload: String) {
        self.seq = seq
        self.sender = sender
        self.kind = kind
        self.payload = payload
    }
}

/// The rendezvous mailbox a ``WebRTCPeer`` handshake runs over (spec §Architecture 3). P0
/// conformer: ``FileSignalingChannel``. P2 conformer: CloudKit.
public protocol SignalingChannel: Sendable {
    /// Sends one envelope. Conformers own the authoritative `sender` identity for envelopes they
    /// persist — see ``FileSignalingChannel`` — so callers need not track it themselves.
    func send(_ envelope: SignalingEnvelope) async throws

    /// Envelopes from OTHER senders only (a channel never echoes its own), in seq order per
    /// sender. Call once per channel — this vends the channel's one `AsyncStream`, not a
    /// broadcast.
    func envelopes() -> AsyncStream<SignalingEnvelope>

    /// Tears down the channel; `envelopes()`'s stream finishes.
    func close() async
}
