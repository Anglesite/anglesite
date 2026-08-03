import Foundation
import OSLog

/// Directory-backed ``SignalingChannel``: each envelope is a file named `<seq>-<sender>.json`,
/// discovered by a 100 ms polling loop (spec §Architecture 3). Local-only test/dev infra for the
/// E2E rig (#589) — not a production rendezvous mechanism (P2 replaces this with a
/// CloudKit-backed conformer for real cross-network signaling).
///
/// `sender` is this channel's own identity, fixed at construction. It is authoritative: `send(_:)`
/// stamps every outgoing envelope (and its filename) with `sender`, superseding whatever the
/// caller passed in `envelope.sender` — so a `WebRTCPeer` handshaking over this channel need not
/// separately track "which side am I" to get correct file naming and self-filtering.
/// `envelopes()` never surfaces a file this channel itself wrote.
public actor FileSignalingChannel: SignalingChannel {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "FileSignalingChannel")
    private static let pollInterval: Duration = .milliseconds(100)
    private static let fileSuffix = ".json"

    private let directory: URL
    private let sender: String

    private let stream: AsyncStream<SignalingEnvelope>
    private let continuation: AsyncStream<SignalingEnvelope>.Continuation
    /// `nonisolated(unsafe)`: assigned once from `init` — where the polling `Task`'s `[weak self]`
    /// capture makes the compiler treat `self` as having "escaped," so it refuses ordinary
    /// actor-isolated access to this property even though the assignment itself happens
    /// synchronously before construction completes — and otherwise only touched from `close()`,
    /// which (like every actor method) runs with exclusive access. No concurrent readers/writers
    /// ever race on it in practice.
    private nonisolated(unsafe) var pollTask: Task<Void, Never>?

    /// Filenames already read into `pending` or already delivered — never re-read on a later poll.
    private var seenFilenames: Set<String> = []
    /// Envelopes read from disk but not yet delivered (out-of-order arrivals), keyed by sender
    /// then seq.
    private var pending: [String: [Int: SignalingEnvelope]] = [:]
    /// The next seq this channel will deliver for each sender. Producers are expected to number
    /// their own envelopes 1, 2, 3, ... (see ``SignalingEnvelope/seq``); a gap simply holds later
    /// envelopes in `pending` until it's filled.
    private var nextExpectedSeq: [String: Int] = [:]
    private var closed = false

    /// Watches `directory` for envelopes from senders other than `sender`, creating the directory
    /// if it doesn't already exist. Polling starts immediately.
    public init(directory: URL, sender: String) {
        self.directory = directory
        self.sender = sender
        (self.stream, self.continuation) = AsyncStream<SignalingEnvelope>.makeStream(bufferingPolicy: .unbounded)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            Self.logger.error("failed to create signaling directory \(directory.path, privacy: .public): \(String(describing: error), privacy: .public)")
        }
        self.pollTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.pollOnce()
                try? await Task.sleep(for: FileSignalingChannel.pollInterval)
            }
        }
    }

    /// Writes `envelope` (stamped with this channel's own `sender` — see the type doc comment) as
    /// `<seq>-<sender>.json`, atomically so a concurrent poll never observes a partial file.
    ///
    /// - Throws: an error if this channel has been closed, or if encoding/writing the file fails.
    public func send(_ envelope: SignalingEnvelope) async throws {
        guard !closed else { throw FileSignalingChannelError.closed }
        var stamped = envelope
        stamped.sender = sender
        let data = try JSONEncoder().encode(stamped)
        let url = directory.appendingPathComponent("\(stamped.seq)-\(sender)\(Self.fileSuffix)")
        try data.write(to: url, options: .atomic)
    }

    /// The single stream of inbound envelopes from other senders, in per-sender seq order.
    /// `nonisolated` (the stream is a `let` fixed at construction) so a caller can start consuming
    /// without an actor hop.
    public nonisolated func envelopes() -> AsyncStream<SignalingEnvelope> { stream }

    /// Stops polling and finishes `envelopes()`'s stream. Idempotent.
    public func close() async {
        guard !closed else { return }
        closed = true
        pollTask?.cancel()
        pollTask = nil
        continuation.finish()
    }

    /// One polling tick: reads any not-yet-seen files from `directory`, buffers them per sender in
    /// `pending`, then delivers whatever contiguous run each sender's `pending` now supports.
    private func pollOnce() async {
        guard !closed else { return }
        let contents: [URL]
        do {
            contents = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        } catch {
            Self.logger.error("failed to list \(self.directory.path, privacy: .public): \(String(describing: error), privacy: .public)")
            return
        }

        for url in contents {
            let filename = url.lastPathComponent
            guard !seenFilenames.contains(filename) else { continue }
            guard let parsed = Self.parse(filename: filename) else { continue }
            seenFilenames.insert(filename)
            guard parsed.sender != sender else { continue } // never echo our own envelopes

            guard let data = try? Data(contentsOf: url),
                  let envelope = try? JSONDecoder().decode(SignalingEnvelope.self, from: data) else {
                Self.logger.error("dropping undecodable signaling file \(filename, privacy: .public)")
                continue
            }
            pending[parsed.sender, default: [:]][parsed.seq] = envelope
        }

        deliverContiguous()
    }

    /// For each sender with buffered envelopes, delivers the contiguous run starting at that
    /// sender's next expected seq, leaving any gap's remainder buffered for a later tick.
    private func deliverContiguous() {
        for fileSender in Array(pending.keys) {
            guard var bucket = pending[fileSender] else { continue }
            var expected = nextExpectedSeq[fileSender] ?? 1
            while let envelope = bucket.removeValue(forKey: expected) {
                continuation.yield(envelope)
                expected += 1
            }
            nextExpectedSeq[fileSender] = expected
            pending[fileSender] = bucket
        }
    }

    /// Parses `<seq>-<sender>.json`. `sender` is everything after the first `-`, so a sender id
    /// containing `-` still round-trips correctly.
    private static func parse(filename: String) -> (seq: Int, sender: String)? {
        guard filename.hasSuffix(fileSuffix) else { return nil }
        let base = filename.dropLast(fileSuffix.count)
        guard let dashIndex = base.firstIndex(of: "-") else { return nil }
        let seqPart = base[base.startIndex..<dashIndex]
        let senderPart = base[base.index(after: dashIndex)...]
        guard let seq = Int(seqPart), !senderPart.isEmpty else { return nil }
        return (seq, String(senderPart))
    }
}

/// Errors specific to ``FileSignalingChannel``.
public enum FileSignalingChannelError: Error, Equatable {
    /// `send(_:)` was called after `close()`.
    case closed
}
