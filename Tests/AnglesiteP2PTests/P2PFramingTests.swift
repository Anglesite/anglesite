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
}
