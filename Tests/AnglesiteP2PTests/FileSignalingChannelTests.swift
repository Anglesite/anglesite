import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct FileSignalingChannelTests {
    @Test func deliversOtherSendersEnvelopesButNeverEchoesOwn() async throws {
        let dir = try Self.makeTempDir()
        let a = FileSignalingChannel(directory: dir, sender: "a")
        let b = FileSignalingChannel(directory: dir, sender: "b")

        var bIterator = b.envelopes().makeAsyncIterator()

        try await a.send(SignalingEnvelope(seq: 1, sender: "a", kind: .offer, payload: "hello"))

        let received = await bIterator.next()
        #expect(received == SignalingEnvelope(seq: 1, sender: "a", kind: .offer, payload: "hello"))

        await a.close()
        await b.close()
    }

    @Test func deliversOutOfOrderWritesInAscendingSeqOrder() async throws {
        let dir = try Self.makeTempDir()
        let a = FileSignalingChannel(directory: dir, sender: "a")
        let b = FileSignalingChannel(directory: dir, sender: "b")

        var bIterator = b.envelopes().makeAsyncIterator()

        // Write seq 2 before seq 1 — delivery to `b` must still be 1 then 2.
        try await a.send(SignalingEnvelope(seq: 2, sender: "a", kind: .candidate, payload: "two"))
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
}
