import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct FileSignalingChannelTests {
    @Test func deliversOtherSendersEnvelopesButNeverEchoesOwn() async throws {
        let dir = try Self.makeTempDir()
        let a = FileSignalingChannel(directory: dir, sender: "a")
        let b = FileSignalingChannel(directory: dir, sender: "b")

        var bIterator = b.envelopes().makeAsyncIterator()
        let aStream = a.envelopes()

        try await a.send(SignalingEnvelope(seq: 1, sender: "a", kind: .offer, payload: "hello"))

        let received = await bIterator.next()
        #expect(received == SignalingEnvelope(seq: 1, sender: "a", kind: .offer, payload: "hello"))

        // `a` must never see the envelope it just wrote itself — race a bounded wait against the
        // first element rather than just never checking `a`'s stream at all.
        let sawOwnEnvelope = await Self.firstEnvelope(on: aStream, within: .milliseconds(350))
        #expect(sawOwnEnvelope == nil)

        await a.close()
        await b.close()
    }

    @Test func deliversOutOfOrderWritesInAscendingSeqOrder() async throws {
        let dir = try Self.makeTempDir()
        let a = FileSignalingChannel(directory: dir, sender: "a")
        let b = FileSignalingChannel(directory: dir, sender: "b")

        var bIterator = b.envelopes().makeAsyncIterator()

        // Write seq 2 first and let at least one 100ms poll tick pass before seq 1 arrives, so
        // this actually exercises the cross-tick pending-buffer path (seq 2 sitting in `pending`
        // across multiple ticks) rather than just a same-tick sort of two files that both showed
        // up before the first poll ever ran. Delivery to `b` must still be 1 then 2.
        try await a.send(SignalingEnvelope(seq: 2, sender: "a", kind: .candidate, payload: "two"))
        try await Task.sleep(for: .milliseconds(150))
        try await a.send(SignalingEnvelope(seq: 1, sender: "a", kind: .offer, payload: "one"))

        let first = await bIterator.next()
        let second = await bIterator.next()
        #expect(first?.payload == "one")
        #expect(second?.payload == "two")

        await a.close()
        await b.close()
    }

    @Test func closeFinishesTheEnvelopesStream() async throws {
        let dir = try Self.makeTempDir()
        let b = FileSignalingChannel(directory: dir, sender: "b")

        let stream = b.envelopes()
        await b.close()

        var iterator = stream.makeAsyncIterator()
        let next = await iterator.next()
        #expect(next == nil)
    }

    private static func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("file-signaling-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Races a fresh iterator's first element against a timeout, returning whichever finishes
    /// first (`nil` if the timeout wins). Used to assert "no envelope arrives" without hanging
    /// forever on a stream that — correctly — never yields anything.
    private static func firstEnvelope(
        on stream: AsyncStream<SignalingEnvelope>,
        within timeout: Duration
    ) async -> SignalingEnvelope? {
        await withTaskGroup(of: SignalingEnvelope?.self) { group in
            group.addTask {
                var iterator = stream.makeAsyncIterator()
                return await iterator.next()
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }
    }
}
