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
/// crossing. `missLimit <= 1` fires on the very first miss.
///
/// - Important: `onMiss` is invoked from a detached `Task`, off this actor — never synchronously
///   from the ping loop or the inbound handler. A slow or blocking `onMiss` therefore cannot stall
///   heartbeat processing, but in exchange **invocation order across misses is not guaranteed**
///   (two `Task`s racing to run `onMiss` can be scheduled out of order). If the owner needs strict
///   ordering, serialize on its own side using the passed-in count.
///
/// - Important: `run()` returns once either loop ends — the connection closes (an outbound send
///   throws ``P2PConnectionError/closed``, or the `control` inbound stream finishes) or the
///   calling `Task` is cancelled — at which point the other loop is cancelled too, so `run()`
///   never keeps firing `onMiss` into a dead connection.
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
    ///   - missLimit: Consecutive misses required before `onMiss` starts firing (`<= 1` fires on
    ///     the first miss).
    ///   - onMiss: Invoked off-actor (see the type doc comment — not synchronous, not ordered)
    ///     with the current consecutive-miss count, once it reaches `missLimit` and again on
    ///     every miss thereafter until a pong arrives and resets the streak.
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

    /// Races the inbound-message loop against the outbound ping loop. The first one to end —
    /// naturally (connection closed) or via cancellation — triggers `cancelAll()` on the other, so
    /// `run()` always returns in bounded time instead of leaking a ping loop that keeps firing
    /// `onMiss` into a connection nothing is listening on anymore.
    public func run() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.sendPings() }
            group.addTask { await self.consumeInbound() }
            await group.next()
            group.cancelAll()
            await group.waitForAll()
        }
    }

    /// Consumes `connection.inbound(.control)`: answers inbound pings with pongs, and matches
    /// inbound pongs against `pendingSeq` to reset the miss streak. Returns when the stream
    /// finishes (the connection closed) or this task is cancelled — `AsyncStream.next()` observes
    /// cancellation of its calling task directly, so no extra `Task.isCancelled` check is needed
    /// in the loop body.
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
    /// went unanswered. Returns as soon as the connection reports itself closed (rather than
    /// looping forever, still "sending" into the void and accumulating misses) or this task is
    /// cancelled.
    private func sendPings() async {
        while !Task.isCancelled {
            let seq = nextSeq
            nextSeq += 1
            pendingSeq = seq
            do {
                try await sendControl(.ping(seq: seq))
            } catch P2PConnectionError.closed {
                return
            } catch {
                Self.logger.error("failed to send ping: \(String(describing: error), privacy: .public)")
            }

            do {
                try await Task.sleep(for: interval)
            } catch {
                return
            }

            if pendingSeq == seq {
                pendingSeq = nil
                consecutiveMisses += 1
                if consecutiveMisses >= missLimit {
                    reportMiss(consecutiveMisses)
                }
            }
        }
    }

    private func respond(to seq: Int) async {
        do {
            try await sendControl(.pong(seq: seq))
        } catch P2PConnectionError.closed {
            // The connection is gone; `consumeInbound`'s stream will finish on its own shortly.
            return
        } catch {
            Self.logger.error("failed to send pong: \(String(describing: error), privacy: .public)")
        }
    }

    private func sendControl(_ message: ControlMessage) async throws {
        let data = try JSONEncoder().encode(message)
        try await connection.send(data, on: .control)
    }

    /// Hops off the actor before invoking `onMiss` — see the type doc comment's `- Important:` on
    /// ordering/blocking.
    private func reportMiss(_ count: Int) {
        let onMiss = self.onMiss
        Task { onMiss(count) }
    }
}
