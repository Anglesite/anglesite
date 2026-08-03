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
    /// Waiters for a channel to open, keyed by a per-call token so `withTaskCancellationHandler`'s
    /// `onCancel` can remove and resume *exactly* the one continuation belonging to a cancelled
    /// call, even when multiple calls are waiting on the same channel concurrently — a plain array
    /// can't be indexed precisely from the separate `onCancel` closure. `Error` (not `Never`) so a
    /// cancelled wait can `resume(throwing: CancellationError())` instead of hanging past the
    /// caller's own cancellation (see `waitForChannelOpen`).
    private var channelOpenContinuations: [P2PChannelID: [UUID: CheckedContinuation<Void, Error>]] = [:]
    /// Same shape/rationale as `channelOpenContinuations`, for `send(_:on:)`'s backpressure wait.
    private var backpressureContinuations: [P2PChannelID: [UUID: CheckedContinuation<Void, Error>]] = [:]

    /// Set once `setRemoteDescription` succeeds; gates `handleRemoteCandidate` (Finding: ICE
    /// candidates that arrive before the SDP that describes them must not be handed to
    /// `RTCPeerConnection.add(_:)`, which fails and silently discards them with no remote
    /// description yet to attach to).
    private var hasRemoteDescription = false
    /// Remote candidates received before `hasRemoteDescription`, flushed by
    /// `markRemoteDescriptionSet()` once it's safe to add them.
    private var bufferedRemoteCandidates: [RTCIceCandidate] = []

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
    ///   happens on the background signaling-loop task, not this call stack. The final wait for
    ///   all four channels to open *does* respond to the calling task's cancellation (including a
    ///   `Test(.timeLimit(...))` firing) — a cancelled wait throws `CancellationError`, and
    ///   `connect` tears the partially-built peer down (`close()`) before rethrowing, so a
    ///   cancelled/failed handshake never leaks the underlying `RTCPeerConnection` or the
    ///   signaling channel's background poll task.
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
        do {
            try await peer.start()
        } catch {
            await peer.close()
            throw error
        }
        return peer
    }

    // MARK: - P2PConnection

    /// - Throws: ``P2PConnectionError/closed`` if the connection (or this channel specifically)
    ///   is closed, or `CancellationError` if the calling task is cancelled while suspended on
    ///   backpressure.
    public func send(_ data: Data, on channel: P2PChannelID) async throws {
        guard !closed, let dataChannel = dataChannels[channel] else {
            throw P2PConnectionError.closed
        }
        while dataChannel.bufferedAmount > Self.backpressureThresholdBytes {
            if closed { throw P2PConnectionError.closed }
            try await waitForBufferedAmountDrop(channel)
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
        for byToken in stillWaitingToOpen.values {
            for continuation in byToken.values { continuation.resume(throwing: P2PConnectionError.closed) }
        }
        let stillBlockedOnBackpressure = backpressureContinuations
        backpressureContinuations.removeAll()
        for byToken in stillBlockedOnBackpressure.values {
            for continuation in byToken.values { continuation.resume(throwing: P2PConnectionError.closed) }
        }
    }

    // MARK: - Handshake

    private func start() async throws {
        startSignalingLoop()
        if role == .offerer {
            createOutboundDataChannels()
            // Reserve the offer's seq synchronously, before the `createOffer`/`setLocalDescription`
            // await chain that triggers ICE gathering — a locally generated candidate's own
            // `sendEnvelope` call (dispatched via `Task` from the delegate) could otherwise win the
            // actor first and claim a lower seq than the offer it describes. Reserving up front
            // guarantees the offer is always seq 1, ahead of any candidate for this role.
            let offerSeq = reserveNextSeq()
            let offer = try await createOffer()
            try await setLocalDescription(offer)
            try await sendEnvelope(seq: offerSeq, kind: .offer, payload: offer.sdp)
        }
        try await waitUntilAllChannelsOpen()
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
            await markRemoteDescriptionSet()
            // Same reservation-ordering reasoning as the offerer's own offer in `start()`: claim
            // the answer's seq before starting the `createAnswer`/`setLocalDescription` chain that
            // triggers this side's own ICE gathering.
            let answerSeq = reserveNextSeq()
            let answer = try await createAnswer()
            try await setLocalDescription(answer)
            try await sendEnvelope(seq: answerSeq, kind: .answer, payload: answer.sdp)
        } catch {
            Self.logger.error("failed to handle remote offer: \(String(describing: error), privacy: .public)")
        }
    }

    private func handleRemoteAnswer(_ sdp: String) async {
        do {
            try await setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp))
            await markRemoteDescriptionSet()
        } catch {
            Self.logger.error("failed to handle remote answer: \(String(describing: error), privacy: .public)")
        }
    }

    /// Records that the remote description is now set and flushes any candidates
    /// `handleRemoteCandidate` buffered because they arrived first. Idempotent — a second call
    /// (there shouldn't be one, but nothing here assumes it) just flushes nothing.
    private func markRemoteDescriptionSet() async {
        hasRemoteDescription = true
        let queued = bufferedRemoteCandidates
        bufferedRemoteCandidates.removeAll()
        for candidate in queued {
            do {
                try await addIceCandidate(candidate)
            } catch {
                Self.logger.error("failed to add buffered remote ice candidate: \(String(describing: error), privacy: .public)")
            }
        }
    }

    /// Buffers the candidate until `markRemoteDescriptionSet()` runs if the remote description
    /// isn't set yet — `RTCPeerConnection.add(_:)` fails (and the candidate is lost for good, no
    /// retry) when called with no remote description to attach it to. This is defense in depth on
    /// top of `start()`/`handleRemoteOffer`'s seq reservation: it keeps `WebRTCPeer` correct even
    /// against a hypothetical `SignalingChannel` conformer that doesn't guarantee strict per-sender
    /// delivery order the way `FileSignalingChannel` does.
    private func handleRemoteCandidate(_ payload: String) async {
        do {
            let decoded = try Self.decodeCandidatePayload(payload)
            let candidate = RTCIceCandidate(
                sdp: decoded.sdp,
                sdpMLineIndex: decoded.sdpMLineIndex,
                sdpMid: decoded.sdpMid
            )
            guard hasRemoteDescription else {
                bufferedRemoteCandidates.append(candidate)
                return
            }
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
        // A delegate callback's `Task { await peer... }` hop can land after `close()` already ran
        // (the callback fired on a libwebrtc thread before teardown, but only reaches the actor
        // afterward) — without this guard it would repopulate `dataChannels`/`dataChannelDelegates`
        // on an otherwise fully torn-down peer.
        guard !closed else {
            dataChannel.close()
            return
        }
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
        guard let byToken = channelOpenContinuations.removeValue(forKey: id) else { return }
        for continuation in byToken.values { continuation.resume() }
    }

    private func waitUntilAllChannelsOpen() async throws {
        for id in P2PChannelID.allCases {
            try await waitForChannelOpen(id)
        }
    }

    /// Suspends until `id` opens, this peer closes (`CancellationError`/`P2PConnectionError.closed`
    /// — see `close()`), or the calling task is cancelled (`CancellationError`).
    ///
    /// Wrapped in `withTaskCancellationHandler` so a `Test(.timeLimit(...))` firing — or any other
    /// caller cancellation — actually interrupts the wait instead of hanging past it: a bare
    /// `withCheckedContinuation` is *not* cancellation-aware on its own, so without this wrapper a
    /// stalled handshake would suspend here forever regardless of the caller's own timeout.
    private func waitForChannelOpen(_ id: P2PChannelID) async throws {
        guard !openedChannels.contains(id) else { return }
        let token = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                // `withTaskCancellationHandler` documents that `onCancel` can fire *before* this
                // operation closure even runs, if the task was already cancelled at the call site
                // above — in that case `onCancel`'s hop would find no token to resume (nothing's
                // stored yet) and this continuation would then hang forever unless we also check
                // here. Actor-isolated + no `await` before this check, so there's no window where
                // a *later* cancellation could sneak in between this check and the store below.
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                channelOpenContinuations[id, default: [:]][token] = continuation
            }
        } onCancel: {
            Task { await self.cancelChannelOpenWait(id, token: token) }
        }
    }

    private func cancelChannelOpenWait(_ id: P2PChannelID, token: UUID) {
        guard var byToken = channelOpenContinuations[id], let continuation = byToken.removeValue(forKey: token) else {
            return
        }
        channelOpenContinuations[id] = byToken.isEmpty ? nil : byToken
        continuation.resume(throwing: CancellationError())
    }

    /// Invoked (via ``DataChannelDelegateBridge``) whenever a data channel's `bufferedAmount`
    /// changes; wakes any `send(_:on:)` call waiting for it to drop back under
    /// `backpressureThresholdBytes`.
    fileprivate func bufferedAmountChanged(_ id: P2PChannelID) {
        guard let dataChannel = dataChannels[id], dataChannel.bufferedAmount <= Self.backpressureThresholdBytes else {
            return
        }
        guard let byToken = backpressureContinuations.removeValue(forKey: id) else { return }
        for continuation in byToken.values { continuation.resume() }
    }

    /// Suspends `send(_:on:)` until `id`'s `bufferedAmount` drops back under the backpressure
    /// threshold, this peer closes, or the calling task is cancelled — same cancellation-handling
    /// shape and same "already cancelled before registering" guard as `waitForChannelOpen`; see
    /// its doc comment for why both are necessary. Also: per SE-0420, whether the `Task { ... }` in
    /// `onCancel` below implicitly inherits this actor's isolation depends on the active Swift
    /// concurrency mode — this code doesn't rely on that either way, since it always explicitly
    /// `await`s back onto the actor via `self.cancelBackpressureWait(...)` regardless.
    private func waitForBufferedAmountDrop(_ channel: P2PChannelID) async throws {
        let token = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                backpressureContinuations[channel, default: [:]][token] = continuation
            }
        } onCancel: {
            Task { await self.cancelBackpressureWait(channel, token: token) }
        }
    }

    private func cancelBackpressureWait(_ channel: P2PChannelID, token: UUID) {
        guard var byToken = backpressureContinuations[channel], let continuation = byToken.removeValue(forKey: token) else {
            return
        }
        backpressureContinuations[channel] = byToken.isEmpty ? nil : byToken
        continuation.resume(throwing: CancellationError())
    }

    // MARK: - ICE

    /// Invoked (via ``PeerConnectionDelegateBridge``) when ICE reports a terminal state (`.failed`
    /// or `.closed`) — the remote is gone (crashed, network partition) and nothing will recover
    /// this connection on its own. Runs the normal `close()` teardown so inbound streams finish
    /// and further `send`s throw, per `P2PConnection`'s documented contract, even without a clean
    /// `.bye` from the far end. `close()` already tolerates its own `.bye` send failing (`try?`),
    /// which is the common case here since the signaling channel or remote may itself be gone.
    fileprivate func handleTerminalIceState(_ state: RTCIceConnectionState) async {
        guard !closed else { return }
        Self.logger.error("ice connection state \(String(describing: state), privacy: .public) — closing")
        await close()
    }

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

    /// Claims the next outbound seq synchronously (no `await`), so a caller that needs to
    /// guarantee its envelope gets a *lower* seq than some other concurrently-triggered send
    /// (e.g. the offer/answer vs. the ICE candidates gathering can fire once it's set as the local
    /// description — see `start()`/`handleRemoteOffer`) can reserve it before starting any
    /// suspending work, then pass it to `sendEnvelope(seq:kind:payload:)` once the payload is
    /// ready.
    private func reserveNextSeq() -> Int {
        outboundSeq += 1
        return outboundSeq
    }

    private func sendEnvelope(kind: SignalingEnvelope.Kind, payload: String) async throws {
        try await sendEnvelope(seq: reserveNextSeq(), kind: kind, payload: payload)
    }

    private func sendEnvelope(seq: Int, kind: SignalingEnvelope.Kind, payload: String) async throws {
        let sender = role == .offerer ? "offerer" : "answerer"
        try await signaling.send(SignalingEnvelope(seq: seq, sender: sender, kind: kind, payload: payload))
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

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        // `.disconnected` is often transient (a brief network blip that self-heals) and isn't
        // treated as terminal here — only `.failed` (ICE gave up) and `.closed` (the connection is
        // gone, including as an echo of our own `close()`) are. This is what makes
        // `P2PConnection`'s documented contract ("`inbound`'s stream finishes when the connection
        // closes") hold even when the remote crashes or the network partitions without ever
        // sending a clean `.bye`.
        guard newState == .failed || newState == .closed else { return }
        guard let peer else { return }
        Task { await peer.handleTerminalIceState(newState) }
    }

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
