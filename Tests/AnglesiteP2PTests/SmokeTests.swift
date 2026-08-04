import Testing
import WebRTC
@testable import AnglesiteP2P

@Suite struct SmokeTests {
    @Test func libwebrtcLinksAndInstantiates() {
        let factory = RTCPeerConnectionFactory()
        _ = factory
        #expect(P2PChannelID.allCases.count == 4)
    }
}
