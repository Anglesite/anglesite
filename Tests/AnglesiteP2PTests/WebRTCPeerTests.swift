import Testing
import Foundation
@testable import AnglesiteP2P

/// Exercises the real libwebrtc `WebRTCPeer` conformer end to end: two peers, real
/// `RTCPeerConnection`s, loopback host candidates only (no STUN/TURN — see
/// `WebRTCPeer.connect`'s `iceServers` default), signaling over a shared `FileSignalingChannel`
/// directory. Gated behind `ANGLESITE_P2P_E2E=1` — it spins up real WebRTC connections, which is
/// too slow/flaky for the default `swift test` run (repo convention, e.g. the MCP/apply-edit e2e
/// suites) but must still be run explicitly before every WebRTCPeer change.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["ANGLESITE_P2P_E2E"] == "1"))
struct WebRTCPeerTests {
    // Repo convention for a test that could hang rather than fail cleanly (e.g. a handshake that
    // never completes) — bounds the run instead of stalling CI/local runs indefinitely.
    @Test(.timeLimit(.minutes(1)))
    func twoRealPeersConnectAndExchangeOnEveryChannel() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("p2p-sig-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        async let hostPeer = WebRTCPeer.connect(role: .answerer, signaling: FileSignalingChannel(directory: dir, sender: "host"))
        async let clientPeer = WebRTCPeer.connect(role: .offerer, signaling: FileSignalingChannel(directory: dir, sender: "client"))
        let (host, client) = try await (hostPeer, clientPeer)
        for channel in P2PChannelID.allCases {
            let inbound = host.inbound(channel)
            try await client.send(Data(channel.rawValue.utf8), on: channel)
            var it = inbound.makeAsyncIterator()
            #expect(await it.next() == Data(channel.rawValue.utf8))
        }
        await client.close()
        await host.close()
    }
}
