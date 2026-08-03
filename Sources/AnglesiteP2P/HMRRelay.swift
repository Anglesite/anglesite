import Foundation
import OSLog

/// Host-side websocket source seam. Production (P1): `URLSessionWebSocketTask` against the
/// dev server's HMR endpoint. Tests: a scripted fake (see `HMRRelayTests`).
public protocol WebSocketSource: Sendable {
    /// The stream of events read off the underlying websocket, in arrival order. Finishes when
    /// the websocket closes.
    func events() -> AsyncStream<HMRFrame>
}

/// Host side of the `hmr` channel: forwards every ``WebSocketSource`` event onto ``P2PConnection``
/// verbatim, in order.
///
/// One `HMRRelayHost` per session, paired with one ``HMRRelayClient`` on the far end (spec
/// §Architecture 1). `run()` owns no lifecycle beyond the forwarding loop itself — closing the
/// underlying dev-server websocket or the `P2PConnection` is the caller's job.
public actor HMRRelayHost {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "HMRRelayHost")

    private let connection: any P2PConnection
    private let source: any WebSocketSource

    /// - Parameters:
    ///   - connection: The shared connection; `run()` sends only on the ``P2PChannelID/hmr``
    ///     channel, leaving the other three untouched.
    ///   - source: The websocket event source to relay.
    public init(connection: any P2PConnection, source: any WebSocketSource) {
        self.connection = connection
        self.source = source
    }

    /// Consumes `source.events()` until it finishes, sending each frame on the `hmr` channel in
    /// order. A send failure (the connection closed mid-relay) is logged and ends the loop —
    /// there's no further point relaying once the far end is gone.
    public func run() async {
        for await frame in source.events() {
            do {
                let data = try frame.encoded()
                try await connection.send(data, on: .hmr)
            } catch {
                Self.logger.error("failed to send hmr frame, stopping relay: \(String(describing: error), privacy: .public)")
                return
            }
        }
    }
}

/// Client side of the `hmr` channel: decoded HMR events for the P4 scheme-handler/webview to
/// consume.
public struct HMRRelayClient: Sendable {
    private let connection: any P2PConnection

    /// Wraps an already-connected ``P2PConnection``.
    public init(connection: any P2PConnection) {
        self.connection = connection
    }

    /// Decodes `connection.inbound(.hmr)` into ``HMRFrame`` values, in order.
    ///
    /// Per ``P2PConnection/inbound(_:)``, the `hmr` channel's inbound stream is single-consumer —
    /// call this once per connection. A frame that fails to decode is logged and skipped, never
    /// silently dropped without a trace and never fatal; the stream finishes when the underlying
    /// channel closes.
    public func events() -> AsyncStream<HMRFrame> {
        let inbound = connection.inbound(.hmr)
        let (stream, continuation) = AsyncStream<HMRFrame>.makeStream(bufferingPolicy: .unbounded)
        let pumpTask = Task {
            for await data in inbound {
                do {
                    let frame = try HMRFrame.decode(data)
                    continuation.yield(frame)
                } catch {
                    Logger(subsystem: "io.dwk.anglesite", category: "HMRRelayClient")
                        .error("dropping undecodable hmr frame (\(data.count, privacy: .public) bytes): \(String(describing: error), privacy: .public)")
                    continue
                }
            }
            continuation.finish()
        }
        continuation.onTermination = { _ in pumpTask.cancel() }
        return stream
    }
}

/// Bidirectional heartbeat over `control`: sends `ping(seq:)` every `interval`, answers inbound
/// pings with pongs, and reports a missed-pong count via `onMiss` so the session owner (P1 helper
/// / P4 runtime) can declare the link dead.
///
/// Misses are consecutive: a pong for the outstanding ping — matched by `seq` — resets the streak
/// to zero. `onMiss` fires once the streak reaches `missLimit`, and again on every miss beyond
/// that (with the growing count), so the owner sees the link degrade rather than just a single
/// crossing.
public actor ControlHeartbeat {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "ControlHeartbeat")

    private let connection: any P2PConnection
    private let interval: Duration
    private let missLimit: Int
    private let onMiss: @Sendable (Int) -> Void

    /// Sequence number of the ping the loop is currently waiting on, or `nil` once it's been
    /// answered (or before the first ping is sent).
    private var pendingSeq: Int?
    private var nextSeq = 0
    private var consecutiveMisses = 0

    /// - Parameters:
    ///   - connection: The shared connection; `run()` exchanges only ``ControlMessage`` JSON on
    ///     the ``P2PChannelID/control`` channel, leaving the other three untouched.
    ///   - interval: How often to send a ping and check for its pong.
    ///   - missLimit: Consecutive misses required before `onMiss` starts firing.
    ///   - onMiss: Invoked with the current consecutive-miss count, once it reaches `missLimit`
    ///     and again on every miss thereafter until a pong arrives and resets the streak.
    public init(
        connection: any P2PConnection,
        interval: Duration,
        missLimit: Int,
        onMiss: @escaping @Sendable (Int) -> Void
    ) {
        self.connection = connection
        self.interval = interval
        self.missLimit = missLimit
        self.onMiss = onMiss
    }

    /// Runs the inbound-message loop and the outbound ping loop concurrently until `connection`'s
    /// `control` stream finishes or this method's `Task` is cancelled.
    public func run() async {
        async let inboundLoop: Void = consumeInbound()
        async let pingLoop: Void = sendPings()
        _ = await (inboundLoop, pingLoop)
    }

    /// Consumes `connection.inbound(.control)`: answers inbound pings with pongs, and matches
    /// inbound pongs against `pendingSeq` to reset the miss streak.
    private func consumeInbound() async {
        for await data in connection.inbound(.control) {
            let message: ControlMessage
            do {
                message = try JSONDecoder().decode(ControlMessage.self, from: data)
            } catch {
                Self.logger.error("dropping undecodable control message (\(data.count, privacy: .public) bytes): \(String(describing: error), privacy: .public)")
                continue
            }

            switch message {
            case .ping(let seq):
                await respond(to: seq)
            case .pong(let seq):
                if pendingSeq == seq {
                    pendingSeq = nil
                    consecutiveMisses = 0
                }
            case .hello, .deployRequest, .deployEvent:
                continue
            }
        }
    }

    /// Sends `ping(seq:)` every `interval`, and after each sleep checks whether the previous ping
    /// went unanswered.
    private func sendPings() async {
        while !Task.isCancelled {
            let seq = nextSeq
            nextSeq += 1
            pendingSeq = seq
            await send(.ping(seq: seq))

            do {
                try await Task.sleep(for: interval)
            } catch {
                return
            }

            if pendingSeq == seq {
                pendingSeq = nil
                consecutiveMisses += 1
                if consecutiveMisses >= missLimit {
                    onMiss(consecutiveMisses)
                }
            }
        }
    }

    private func respond(to seq: Int) async {
        await send(.pong(seq: seq))
    }

    private func send(_ message: ControlMessage) async {
        do {
            let data = try JSONEncoder().encode(message)
            try await connection.send(data, on: .control)
        } catch {
            Self.logger.error("failed to send control message: \(String(describing: error), privacy: .public)")
        }
    }
}
