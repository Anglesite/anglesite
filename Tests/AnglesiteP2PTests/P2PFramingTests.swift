import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct P2PFramingTests {
    @Test func httpFrameRoundTripsAllKinds() throws {
        let frames: [HTTPBridgeFrame] = [
            .requestHead(id: 7, BridgeRequestHead(method: "GET", path: "/a?b=1", headers: ["Accept": "text/html"])),
            .requestBody(id: 7, Data([0x00, 0xFF])),
            .requestEnd(id: 7),
            .responseHead(id: 7, BridgeResponseHead(status: 200, headers: ["Content-Type": "text/html"])),
            .responseBody(id: 7, Data("hi".utf8)),
            .responseEnd(id: 7),
            .abort(id: 9, reason: "cancelled"),
        ]
        for frame in frames {
            #expect(try HTTPBridgeFrame.decode(frame.encoded()) == frame)
        }
    }

    @Test func truncatedFrameThrowsMalformed() {
        #expect(throws: P2PFramingError.malformed) { _ = try HTTPBridgeFrame.decode(Data([0x00, 0x01])) }
    }

    @Test func unknownKindThrows() {
        var data = Data([0x63]); data.append(contentsOf: [0, 0, 0, 1])
        #expect(throws: P2PFramingError.unknownKind(0x63)) { _ = try HTTPBridgeFrame.decode(data) }
    }

    @Test func hmrFrameRoundTrips() throws {
        for frame in [HMRFrame.text("reload"), .binary(Data([1, 2])), .closed(code: 1001)] {
            #expect(try HMRFrame.decode(frame.encoded()) == frame)
        }
    }

    @Test func controlMessageRoundTrips() throws {
        let msg = ControlMessage.ping(seq: 3)
        let data = try JSONEncoder().encode(msg)
        #expect(try JSONDecoder().decode(ControlMessage.self, from: data) == msg)
    }

    @Test func httpFrameDecodeFromSlicedData() throws {
        let frame = HTTPBridgeFrame.requestEnd(id: 42)
        let encoded = try frame.encoded()

        // Create a non-zero-based slice by using dropFirst (preserves startIndex offset)
        let junk = Data([0xFF, 0xEE, 0xDD])
        var buffer = junk
        buffer.append(contentsOf: encoded)

        let sliced = buffer.dropFirst(3)  // Non-zero-based slice via dropFirst

        // Verify precondition: slice must have non-zero startIndex
        #expect(sliced.startIndex != 0)

        // Should decode correctly despite non-zero startIndex
        let decoded = try HTTPBridgeFrame.decode(sliced)
        #expect(decoded == frame)
    }

    @Test func hmrFrameDecodeFromSlicedData() throws {
        let frame = HMRFrame.text("hello")
        let encoded = try frame.encoded()

        // Create a non-zero-based slice by using range subscript (preserves startIndex offset)
        let junk = Data([0xAA, 0xBB])
        var buffer = junk
        buffer.append(contentsOf: encoded)

        let sliced = buffer[2...]  // Non-zero-based slice via range subscript

        // Verify precondition: slice must have non-zero startIndex
        #expect(sliced.startIndex != 0)

        // Should decode correctly despite non-zero startIndex
        let decoded = try HMRFrame.decode(sliced)
        #expect(decoded == frame)
    }

    @Test func truncatedSliceThrowsMalformed() throws {
        let frame = HTTPBridgeFrame.requestEnd(id: 7)
        let encoded = try frame.encoded()

        // Create a buffer and extract a non-zero-based truncated slice
        var buffer = Data([0xFF, 0xFF, 0xFF, 0xFF])
        buffer.append(contentsOf: encoded)

        // Use dropFirst to create non-zero-based slice, then truncate it
        let sliced = buffer.dropFirst(4).prefix(3)  // 3 bytes with non-zero startIndex

        // Verify precondition: slice must have non-zero startIndex
        #expect(sliced.startIndex != 0)

        #expect(throws: P2PFramingError.malformed) { _ = try HTTPBridgeFrame.decode(sliced) }
    }

    @Test func invalidJsonPayloadThrowsMalformed() throws {
        // Create a requestHead frame with garbage JSON payload
        var data = Data([0])  // kind = 0 (requestHead)
        data.append(contentsOf: [0, 0, 0, 7])  // id = 7
        data.append(contentsOf: [0x7B, 0x69, 0x6E, 0x76, 0x61, 0x6C, 0x69, 0x64])  // "invalid" (not JSON)

        #expect(throws: P2PFramingError.malformed) { _ = try HTTPBridgeFrame.decode(data) }
    }

    @Test func hmrClosedFrameWithoutCodeThrowsMalformed() throws {
        // Create a closed frame with only 1 byte of code (need 2)
        var data = Data([2])  // kind = 2 (closed)
        data.append(0x04)  // only 1 byte of code

        #expect(throws: P2PFramingError.malformed) { _ = try HMRFrame.decode(data) }
    }
}
