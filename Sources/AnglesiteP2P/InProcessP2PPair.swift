import Foundation

/// Loopback pair of ``P2PConnection`` endpoints: whatever one end sends, the other receives, per
/// channel. Stands in for a real WebRTC peer connection in tests and local demos (spec §Architecture
/// 1) — no signaling, no network, just two actors wired to each other in-process.
public struct InProcessP2PPair: Sendable {
    /// One side of the loopback pair.
    public let a: End
    /// The other side of the loopback pair.
    public let b: End

    /// Builds a connected pair: whatever `a` sends arrives on the matching `b.inbound` stream,
    /// and vice versa.
    public static func make() -> InProcessP2PPair {
        let a = End()
        let b = End()
        a.wire(to: b)
        b.wire(to: a)
        return InProcessP2PPair(a: a, b: b)
    }

    /// One endpoint of an ``InProcessP2PPair``. Conforms to ``P2PConnection`` so production code
    /// under test can hold it behind that protocol exactly like a real `WebRTCPeer`.
    ///
    /// `P2PConnection.inbound(_:)` is a synchronous (non-`async`) requirement, so an actor can
    /// only satisfy it with a `nonisolated` method — which cannot touch ordinary actor-isolated
    /// storage. Per-channel stream state therefore lives in `channels`, a `nonisolated` locked box
    /// rather than actor-isolated `var`s; `send`/`close` stay actor methods (their protocol
    /// requirements are `async`) but reach the same state through that box.
    public actor End: P2PConnection {
        /// Reference to the paired `End`, set exactly once by `wire(to:)` before any concurrent
        /// use begins. `make()`'s public signature is synchronous, so it cannot `await` into this
        /// actor to assign a normal actor-isolated stored property after construction; routing the
        /// assignment through a `nonisolated` box (a plain, non-actor class) sidesteps that without
        /// changing the public API. Safe because the single write always happens-before any `send`,
        /// `inbound`, or `close` call that reads it.
        private nonisolated let peerBox = PeerBox()

        /// Per-channel `AsyncStream` state, outside actor isolation — see the type doc comment.
        private nonisolated let channels = ChannelBox()

        fileprivate init() {}

        fileprivate nonisolated func wire(to peer: End) {
            peerBox.peer = peer
        }

        /// - Throws: ``P2PConnectionError/closed`` if this end has been closed.
        public func send(_ data: Data, on channel: P2PChannelID) async throws {
            guard !channels.isClosed, let peer = peerBox.peer else {
                throw P2PConnectionError.closed
            }
            await peer.deliver(data, on: channel)
        }

        /// Returns `channel`'s inbound stream, creating it on first call. Already-closed ends
        /// return a stream that finishes immediately.
        public nonisolated func inbound(_ channel: P2PChannelID) -> AsyncStream<Data> {
            channels.inbound(channel)
        }

        /// Closes both ends of the pair: finishes every inbound stream on `self` and on the peer,
        /// and makes subsequent `send` calls on either end throw ``P2PConnectionError/closed``.
        public func close() async {
            channels.finishAll()
            if let peer = peerBox.peer {
                await peer.finishAllFromPeer()
            }
        }

        /// Delivers a message sent by the peer onto the matching local channel. A no-op if this
        /// end is already closed (mirrors a real transport dropping traffic post-teardown).
        fileprivate func deliver(_ data: Data, on channel: P2PChannelID) {
            channels.deliver(data, on: channel)
        }

        /// Invoked by the peer's `close()` to finish this end's streams too. Idempotent.
        fileprivate func finishAllFromPeer() {
            channels.finishAll()
        }
    }
}

/// Holds an ``InProcessP2PPair/End``'s peer reference outside actor isolation so it can be set
/// synchronously by `wire(to:)`. Not thread-safe by construction — safe only because the single
/// write happens before any concurrent read (see `End.peerBox`'s doc comment).
private final class PeerBox: @unchecked Sendable {
    var peer: InProcessP2PPair.End?
}

/// Lock-guarded per-channel `AsyncStream` state for an ``InProcessP2PPair/End``. Exists so
/// `inbound(_:)` can satisfy `P2PConnection`'s synchronous requirement without actor isolation
/// (see `End`'s type doc comment); `@unchecked Sendable` because `NSLock` — not the type system —
/// is what makes concurrent access safe here.
private final class ChannelBox: @unchecked Sendable {
    private let lock = NSLock()
    private var streams: [P2PChannelID: AsyncStream<Data>] = [:]
    private var continuations: [P2PChannelID: AsyncStream<Data>.Continuation] = [:]
    private var closed = false

    var isClosed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return closed
    }

    func inbound(_ channel: P2PChannelID) -> AsyncStream<Data> {
        lock.lock()
        defer { lock.unlock() }
        let (stream, continuation) = channelPair(for: channel)
        if closed {
            continuation.finish()
        }
        return stream
    }

    func deliver(_ data: Data, on channel: P2PChannelID) {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        channelPair(for: channel).continuation.yield(data)
    }

    func finishAll() {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        closed = true
        for continuation in continuations.values {
            continuation.finish()
        }
    }

    /// Must be called with `lock` already held.
    private func channelPair(
        for channel: P2PChannelID
    ) -> (stream: AsyncStream<Data>, continuation: AsyncStream<Data>.Continuation) {
        if let stream = streams[channel], let continuation = continuations[channel] {
            return (stream, continuation)
        }
        let (stream, continuation) = AsyncStream<Data>.makeStream(of: Data.self)
        streams[channel] = stream
        continuations[channel] = continuation
        return (stream, continuation)
    }
}
