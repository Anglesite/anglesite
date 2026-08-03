import Foundation
import OSLog
import WebRTC

/// Initializes libwebrtc's SSL library exactly once, process-wide, before any
/// `RTCPeerConnectionFactory` or `RTCPeerConnection` is constructed — required by libwebrtc (its
/// own docs call failure fatal). A Swift file-scope `let` is lazily initialized on first access,
/// under the same guarantee as `dispatch_once`, so referencing this from `sharedFactory`'s own
/// lazy initializer both forces the ordering and makes the call happen exactly once.
private let webRTCSSLInitialized: Bool = {
    let ok = RTCInitializeSSL()
    if !ok {
        Logger(subsystem: "io.dwk.anglesite", category: "WebRTCPeer")
            .fault("RTCInitializeSSL() failed — libwebrtc calls after this point are unsafe")
    }
    return ok
}()

/// The single `RTCPeerConnectionFactory` for the process — libwebrtc expects one factory to back
/// every peer connection. `nonisolated(unsafe)`: `RTCPeerConnectionFactory` isn't `Sendable`
/// (it's an un-audited Objective-C type), but libwebrtc's own contract is that a factory is safe
/// to use concurrently from multiple threads once constructed, which is exactly how every native
/// WebRTC embedder (mobile or desktop) uses it — so sharing it across this file's actor-isolated
/// and nonisolated call sites is safe in practice even though the compiler can't verify it.
private nonisolated(unsafe) let sharedFactory: RTCPeerConnectionFactory = {
    _ = webRTCSSLInitialized
    return RTCPeerConnectionFactory()
}()

/// The libwebrtc conformer of ``P2PConnection`` — the only file in this module importing
/// `WebRTC`.
///
/// `connect(role:signaling:iceServers:)` drives a full offer/answer + trickle-ICE handshake over
/// a ``SignalingChannel`` and does not return until all four ``P2PChannelID`` data channels are
/// open. The offerer creates the four data channels (labels = ``P2PChannelID`` raw values)
/// *before* creating the offer, so their existence is captured in the initial SDP; the answerer
/// never calls `dataChannel(forLabel:configuration:)` itself — it discovers each channel via
/// `RTCPeerConnectionDelegate.peerConnection(_:didOpen:)` once the offerer's SDP negotiates it in.
///
/// - Important: every `RTCPeerConnectionDelegate`/`RTCDataChannelDelegate` callback below arrives
///   on a libwebrtc-owned thread, never this actor's executor. Callbacks that touch actor state
///   hop via `Task { await self... }` (see ``PeerConnectionDelegateBridge`` /
///   ``DataChannelDelegateBridge``); the one exception is routing already-received message bytes
///   into a channel's inbound `AsyncStream`, which goes straight into ``InboundChannelBox`` — a
///   lock-guarded, non-actor-isolated store — precisely so that hot path never needs the hop.
public actor WebRTCPeer: P2PConnection {
    /// Which side of the offer/answer exchange this peer plays.
    public enum Role: Sendable { case offerer, answerer }

    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "WebRTCPeer")

    /// `send(_:on:)` backpressure ceiling: once a data channel's `bufferedAmount` exceeds this,
    /// `send` suspends until `didChangeBufferedAmount` reports it back under the line, rather than
    /// buffering unboundedly or busy-spinning.
    private static let backpressureThresholdBytes: UInt64 = 1 * 1024 * 1024

    private let role: Role
    private let peerConnection: RTCPeerConnection
    private let signaling: any SignalingChannel
    /// Retained here because `RTCPeerConnection.delegate` is `weak` — without a strong owner the
    /// bridge would be deallocated immediately after `connect` assigns it.
    private let delegateBridge: PeerConnectionDelegateBridge

    /// Inbound per-channel message storage, outside actor isolation — see the type doc comment
    /// and ``InboundChannelBox``.
    private nonisolated let channelBox = InboundChannelBox()

    private var dataChannels: [P2PChannelID: RTCDataChannel] = [:]
    /// Retained per data channel for the same reason as `delegateBridge` (`RTCDataChannel.delegate`
    /// is also `weak`).
    private var dataChannelDelegates: [P2PChannelID: DataChannelDelegateBridge] = [:]

    private var openedChannels: Set<P2PChannelID> = []
    private var channelOpenContinuations: [P2PChannelID: [CheckedContinuation<Void, Never>]] = [:]
    private var backpressureContinuations: [P2PChannelID: [CheckedContinuation<Void, Never>]] = [:]

    private var outboundSeq = 0
    private var signalingTask: Task<Void, Never>?
    private var closed = false

    private init(
        role: Role,
        peerConnection: RTCPeerConnection,
        signaling: any SignalingChannel,
        delegateBridge: PeerConnectionDelegateBridge
    ) {
        self.role = role
        self.peerConnection = peerConnection
        self.signaling = signaling
        self.delegateBridge = delegateBridge
    }

    /// Drives signaling to a connected state and returns once all four channels are open.
    ///
    /// - Parameters:
    ///   - role: `.offerer` creates the data channels and sends the SDP offer; `.answerer` waits
    ///     for one and answers it.
    ///   - signaling: The mailbox both sides trickle SDP/ICE over — see ``SignalingChannel``.
    ///   - iceServers: STUN/TURN server URLs, one `RTCIceServer` per string. Empty by default:
    ///     loopback/E2E tests need no external server since host candidates already reach each
    ///     other; P3 injects real STUN/TURN for cross-network use.
    /// - Throws: if the local `RTCPeerConnection` can't be constructed, or (offerer only) if
    ///   creating/setting the initial offer fails. A failure on the answerer's side of the
    ///   handshake (bad remote offer, failed answer) is logged rather than thrown here, since it
    ///   happens on the background signaling-loop task, not this call stack — callers should
    ///   bound their own wait (as the gated `WebRTCPeerTests` suite does with `.timeLimit`).
    public static func connect(
        role: Role,
        signaling: any SignalingChannel,
        iceServers: [String] = []
    ) async throws -> WebRTCPeer {
        let configuration = RTCConfiguration()
        configuration.iceServers = iceServers.map { RTCIceServer(urlStrings: [$0]) }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)

        let delegateBridge = PeerConnectionDelegateBridge()
        guard let peerConnection = sharedFactory.peerConnection(
            with: configuration,
            constraints: constraints,
            delegate: delegateBridge
        ) else {
            throw WebRTCPeerError.peerConnectionCreationFailed
        }

        let peer = WebRTCPeer(
            role: role,
            peerConnection: peerConnection,
            signaling: signaling,
            delegateBridge: delegateBridge
        )
        delegateBridge.peer = peer
        try await peer.start()
        return peer
    }

    // MARK: - P2PConnection

    /// - Throws: ``P2PConnectionError/closed`` if the connection (or this channel specifically)
    ///   is closed.
    public func send(_ data: Data, on channel: P2PChannelID) async throws {
        guard !closed, let dataChannel = dataChannels[channel] else {
            throw P2PConnectionError.closed
        }
        while dataChannel.bufferedAmount > Self.backpressureThresholdBytes {
            if closed { throw P2PConnectionError.closed }
            await withCheckedContinuation { continuation in
                backpressureContinuations[channel, default: []].append(continuation)
            }
        }
        guard !closed, dataChannel.readyState == .open else {
            throw P2PConnectionError.closed
        }
        let buffer = RTCDataBuffer(data: data, isBinary: true)
        guard dataChannel.sendData(buffer) else {
            throw P2PConnectionError.closed
        }
    }

    public nonisolated func inbound(_ channel: P2PChannelID) -> AsyncStream<Data> {
        channelBox.inbound(channel)
    }

    /// Sends `.bye`, closes every data channel and the underlying `RTCPeerConnection`, and
    /// finishes all inbound streams. Idempotent.
    public func close() async {
        guard !closed else { return }
        closed = true

        signalingTask?.cancel()
        signalingTask = nil
        try? await sendEnvelope(kind: .bye, payload: "")
        await signaling.close()

        for dataChannel in dataChannels.values { dataChannel.close() }
        dataChannels.removeAll()
        dataChannelDelegates.removeAll()
        peerConnection.close()
        channelBox.finishAll()

        let stillWaitingToOpen = channelOpenContinuations
        channelOpenContinuations.removeAll()
        for continuations in stillWaitingToOpen.values {
            for continuation in continuations { continuation.resume() }
        }
        let stillBlockedOnBackpressure = backpressureContinuations
        backpressureContinuations.removeAll()
        for continuations in stillBlockedOnBackpressure.values {
            for continuation in continuations { continuation.resume() }
        }
    }

    // MARK: - Handshake

    private func start() async throws {
        startSignalingLoop()
        if role == .offerer {
            createOutboundDataChannels()
            let offer = try await createOffer()
            try await setLocalDescription(offer)
            try await sendEnvelope(kind: .offer, payload: offer.sdp)
        }
        await waitUntilAllChannelsOpen()
    }

    private func startSignalingLoop() {
        let envelopes = signaling.envelopes()
        signalingTask = Task { [weak self] in
            for await envelope in envelopes {
                guard let self else { return }
                await self.handleInbound(envelope)
            }
        }
    }

    private func handleInbound(_ envelope: SignalingEnvelope) async {
        switch envelope.kind {
        case .offer:
            await handleRemoteOffer(envelope.payload)
        case .answer:
            await handleRemoteAnswer(envelope.payload)
        case .candidate:
            await handleRemoteCandidate(envelope.payload)
        case .bye:
            await close()
        }
    }

    private func handleRemoteOffer(_ sdp: String) async {
        do {
            try await setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp))
            let answer = try await createAnswer()
            try await setLocalDescription(answer)
            try await sendEnvelope(kind: .answer, payload: answer.sdp)
        } catch {
            Self.logger.error("failed to handle remote offer: \(String(describing: error), privacy: .public)")
        }
    }

    private func handleRemoteAnswer(_ sdp: String) async {
        do {
            try await setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp))
        } catch {
            Self.logger.error("failed to handle remote answer: \(String(describing: error), privacy: .public)")
        }
    }

    private func handleRemoteCandidate(_ payload: String) async {
        do {
            let decoded = try Self.decodeCandidatePayload(payload)
            let candidate = RTCIceCandidate(
                sdp: decoded.sdp,
                sdpMLineIndex: decoded.sdpMLineIndex,
                sdpMid: decoded.sdpMid
            )
            try await addIceCandidate(candidate)
        } catch {
            Self.logger.error("failed to add remote ice candidate: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Data channels

    private func createOutboundDataChannels() {
        for id in P2PChannelID.allCases {
            let configuration = RTCDataChannelConfiguration()
            guard let dataChannel = peerConnection.dataChannel(forLabel: id.rawValue, configuration: configuration) else {
                Self.logger.error("failed to create data channel \(id.rawValue, privacy: .public)")
                continue
            }
            registerDataChannel(dataChannel, id: id)
        }
    }

    /// Invoked (via ``PeerConnectionDelegateBridge``) when the answerer's peer connection learns
    /// about a data channel the offerer created.
    fileprivate func handleRemoteDataChannel(_ dataChannel: RTCDataChannel) {
        guard let id = P2PChannelID(rawValue: dataChannel.label) else {
            Self.logger.error("ignoring data channel with unrecognized label \(dataChannel.label, privacy: .public)")
            return
        }
        registerDataChannel(dataChannel, id: id)
    }

    private func registerDataChannel(_ dataChannel: RTCDataChannel, id: P2PChannelID) {
        let bridge = DataChannelDelegateBridge(channelID: id, peer: self, inboundBox: channelBox)
        dataChannel.delegate = bridge
        dataChannelDelegates[id] = bridge
        dataChannels[id] = dataChannel
        if dataChannel.readyState == .open {
            markChannelOpen(id)
        }
    }

    /// Invoked (via ``DataChannelDelegateBridge``) on every state change of one of this peer's
    /// data channels.
    fileprivate func handleDataChannelStateChange(_ id: P2PChannelID, dataChannel: RTCDataChannel) {
        if dataChannel.readyState == .open {
            markChannelOpen(id)
        }
    }

    private func markChannelOpen(_ id: P2PChannelID) {
        guard openedChannels.insert(id).inserted else { return }
        guard let continuations = channelOpenContinuations.removeValue(forKey: id) else { return }
        for continuation in continuations { continuation.resume() }
    }

    private func waitUntilAllChannelsOpen() async {
        for id in P2PChannelID.allCases {
            guard !openedChannels.contains(id) else { continue }
            await withCheckedContinuation { continuation in
                channelOpenContinuations[id, default: []].append(continuation)
            }
        }
    }

    /// Invoked (via ``DataChannelDelegateBridge``) whenever a data channel's `bufferedAmount`
    /// changes; wakes any `send(_:on:)` call waiting for it to drop back under
    /// `backpressureThresholdBytes`.
    fileprivate func bufferedAmountChanged(_ id: P2PChannelID) {
        guard let dataChannel = dataChannels[id], dataChannel.bufferedAmount <= Self.backpressureThresholdBytes else {
            return
        }
        guard let continuations = backpressureContinuations.removeValue(forKey: id) else { return }
        for continuation in continuations { continuation.resume() }
    }

    // MARK: - ICE

    /// Invoked (via ``PeerConnectionDelegateBridge``) for every locally gathered ICE candidate;
    /// trickles it to the peer as a `.candidate` envelope.
    fileprivate func handleLocalCandidate(_ candidate: RTCIceCandidate) async {
        do {
            let payload = try Self.encodeCandidatePayload(
                ICECandidatePayload(sdp: candidate.sdp, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid)
            )
            try await sendEnvelope(kind: .candidate, payload: payload)
        } catch {
            Self.logger.error("failed to send local ice candidate: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Signaling helpers

    private func sendEnvelope(kind: SignalingEnvelope.Kind, payload: String) async throws {
        outboundSeq += 1
        let sender = role == .offerer ? "offerer" : "answerer"
        try await signaling.send(SignalingEnvelope(seq: outboundSeq, sender: sender, kind: kind, payload: payload))
    }

    private struct ICECandidatePayload: Codable {
        let sdp: String
        let sdpMLineIndex: Int32
        let sdpMid: String?
    }

    private static func encodeCandidatePayload(_ payload: ICECandidatePayload) throws -> String {
        let data = try JSONEncoder().encode(payload)
        guard let string = String(data: data, encoding: .utf8) else {
            throw WebRTCPeerError.candidateEncodingFailed
        }
        return string
    }

    private static func decodeCandidatePayload(_ payload: String) throws -> ICECandidatePayload {
        guard let data = payload.data(using: .utf8) else {
            throw WebRTCPeerError.candidateEncodingFailed
        }
        return try JSONDecoder().decode(ICECandidatePayload.self, from: data)
    }

    // MARK: - RTCPeerConnection completion-handler bridging

    private func createOffer() async throws -> RTCSessionDescription {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        return try await withCheckedThrowingContinuation { continuation in
            peerConnection.offer(for: constraints) { sdp, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let sdp {
                    continuation.resume(returning: sdp)
                } else {
                    continuation.resume(throwing: WebRTCPeerError.missingSessionDescription)
                }
            }
        }
    }

    private func createAnswer() async throws -> RTCSessionDescription {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        return try await withCheckedThrowingContinuation { continuation in
            peerConnection.answer(for: constraints) { sdp, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let sdp {
                    continuation.resume(returning: sdp)
                } else {
                    continuation.resume(throwing: WebRTCPeerError.missingSessionDescription)
                }
            }
        }
    }

    private func setLocalDescription(_ sdp: RTCSessionDescription) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setLocalDescription(sdp) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    private func setRemoteDescription(_ sdp: RTCSessionDescription) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setRemoteDescription(sdp) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    private func addIceCandidate(_ candidate: RTCIceCandidate) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.add(candidate) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
}

/// Errors specific to ``WebRTCPeer``.
public enum WebRTCPeerError: Error, Equatable {
    case peerConnectionCreationFailed
    case missingSessionDescription
    case candidateEncodingFailed
}

/// Bridges `RTCPeerConnectionDelegate` callbacks — delivered on a libwebrtc-owned thread — to
/// ``WebRTCPeer``'s actor-isolated state via `Task { await peer... }`.
///
/// `@unchecked Sendable`: `peer` is a `weak var` written exactly once, by `WebRTCPeer.connect`,
/// before `peerConnection.delegate` is ever assigned to this bridge — so no callback can observe
/// it during that single write — and never mutated again. Safe to read concurrently from any
/// libwebrtc thread thereafter.
private final class PeerConnectionDelegateBridge: NSObject, RTCPeerConnectionDelegate, @unchecked Sendable {
    weak var peer: WebRTCPeer?

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        guard let peer else { return }
        Task { await peer.handleLocalCandidate(candidate) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        guard let peer else { return }
        Task { await peer.handleRemoteDataChannel(dataChannel) }
    }
}

/// Bridges `RTCDataChannelDelegate` callbacks for one data channel — delivered on a
/// libwebrtc-owned thread — to ``WebRTCPeer``'s actor-isolated state, except for inbound message
/// delivery, which goes straight into `inboundBox` (see ``InboundChannelBox``) without an actor
/// hop.
///
/// `@unchecked Sendable`: `channelID` and `inboundBox` are immutable `let`s; `peer` is a `weak
/// var` written exactly once at construction, before this bridge is ever assigned as a channel's
/// `delegate` — see ``PeerConnectionDelegateBridge``'s doc comment for the same argument.
private final class DataChannelDelegateBridge: NSObject, RTCDataChannelDelegate, @unchecked Sendable {
    let channelID: P2PChannelID
    weak var peer: WebRTCPeer?
    let inboundBox: InboundChannelBox

    init(channelID: P2PChannelID, peer: WebRTCPeer, inboundBox: InboundChannelBox) {
        self.channelID = channelID
        self.peer = peer
        self.inboundBox = inboundBox
    }

    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        guard let peer else { return }
        let id = channelID
        Task { await peer.handleDataChannelStateChange(id, dataChannel: dataChannel) }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        inboundBox.deliver(buffer.data, on: channelID)
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didChangeBufferedAmount amount: UInt64) {
        guard let peer else { return }
        let id = channelID
        Task { await peer.bufferedAmountChanged(id) }
    }
}

/// Lock-guarded per-channel inbound `AsyncStream` state, entirely outside actor isolation.
/// `P2PConnection.inbound(_:)` is a synchronous protocol requirement, so ``WebRTCPeer`` (an
/// actor) can only satisfy it via a `nonisolated` method that cannot touch ordinary
/// actor-isolated storage — this box holds that state instead, mirroring
/// `InProcessP2PPair.ChannelBox`. It also lets `RTCDataChannelDelegate`'s message callback
/// (invoked on a libwebrtc thread) deliver inbound bytes without hopping onto the actor at all,
/// since delivery touches only this lock-guarded box, never actor-isolated state.
private final class InboundChannelBox: @unchecked Sendable {
    private let lock = NSLock()
    private var streams: [P2PChannelID: AsyncStream<Data>] = [:]
    private var continuations: [P2PChannelID: AsyncStream<Data>.Continuation] = [:]
    private var closed = false

    func inbound(_ channel: P2PChannelID) -> AsyncStream<Data> {
        lock.lock()
        defer { lock.unlock() }
        let pair = channelPair(for: channel)
        if closed { pair.continuation.finish() }
        return pair.stream
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
        for continuation in continuations.values { continuation.finish() }
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
