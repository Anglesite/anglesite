import AVFoundation
import AnglesiteCore

/// Plays (or doesn't) the synthesized dial-up modem sound effect
/// (`DialupModemSoundEffect`) while a "loading" operation is in flight — dev-server startup,
/// deploy. `play()` checks `AppSettings.shared.playsDialupSoundEffect` first and never touches
/// the audio engine when the setting is off.
@MainActor
protocol DialupSoundEffectPlaying {
    /// Starts the looping handshake sound if the setting is on and it isn't already playing.
    /// No-op when the setting is off. Idempotent while already playing.
    func play()
    /// Stops playback. Idempotent while already stopped.
    func stop()
}

/// Thin `AVFoundation` glue by design — deliberately untested directly (mirrors
/// `CompletionNotifier`'s shape). The audio it plays (`DialupModemSoundEffect`) is unit-tested
/// in `AnglesiteCoreTests`.
@MainActor
final class DialupSoundEffectPlayer: DialupSoundEffectPlaying {
    /// The AVFoundation objects that are expensive to build (synthesized PCM buffer, audio
    /// engine, player node) — bundled together so they can be constructed lazily on first real
    /// playback instead of unconditionally in `init`. Building `AVAudioEngine` and touching
    /// `engine.mainMixerNode` forces CoreAudio HAL unit instantiation on first use, so this must
    /// stay off the `init` path: two independent players are constructed per site window
    /// regardless of whether the setting is on.
    private struct PreparedAudio {
        let engine: AVAudioEngine
        let playerNode: AVAudioPlayerNode
        let buffer: AVAudioPCMBuffer
    }

    private let settings: AppSettings
    private var prepared: PreparedAudio?
    private var isPlaying = false

    init(settings: AppSettings = .shared) {
        self.settings = settings
    }

    /// Synthesizes the audio and builds the engine/buffer/node graph, unless that already
    /// happened. Only called from `play()`, after the settings-and-idempotency guard passes —
    /// so this cost is paid at most once per player, and never at all while the setting stays
    /// off.
    private func prepare() -> PreparedAudio {
        if let prepared { return prepared }
        let samples = DialupModemSoundEffect.samples()
        // Mono, matches `DialupModemSoundEffect.sampleRate` — always valid, so the failable
        // initializers below can't realistically return nil for these fixed, known-good inputs.
        let format = AVAudioFormat(
            standardFormatWithSampleRate: DialupModemSoundEffect.sampleRate, channels: 1)!
        let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))!
        pcmBuffer.frameLength = AVAudioFrameCount(samples.count)
        let channelData = pcmBuffer.floatChannelData![0]
        for (index, sample) in samples.enumerated() {
            channelData[index] = sample
        }
        let engine = AVAudioEngine()
        let playerNode = AVAudioPlayerNode()
        engine.attach(playerNode)
        // Freshly attached nodes with this fixed, known-good format can't realistically fail to
        // connect, so a thrown error here (macOS 27's throwing `connectNode` replaces the
        // deprecated non-throwing `connect`) is discarded like the force-unwraps above.
        try? engine.connectNode(playerNode, to: engine.mainMixerNode, format: format)
        let result = PreparedAudio(engine: engine, playerNode: playerNode, buffer: pcmBuffer)
        prepared = result
        return result
    }

    func play() {
        guard settings.playsDialupSoundEffect, !isPlaying else { return }
        isPlaying = true
        let prepared = prepare()
        do {
            try prepared.engine.start()
        } catch {
            // Purely decorative — a failure to start the audio engine (e.g. no output device)
            // should never surface to the user or block the operation it's soundtracking.
            isPlaying = false
            return
        }
        prepared.playerNode.scheduleBuffer(prepared.buffer, at: nil, options: .loops)
        do {
            // macOS 27's throwing `playAudio` replaces the deprecated non-throwing `play`.
            try prepared.playerNode.playAudio()
        } catch {
            // Same rationale as the `engine.start()` failure above: never surface or block.
            isPlaying = false
            prepared.playerNode.stop()
            prepared.engine.stop()
        }
    }

    func stop() {
        guard isPlaying else { return }
        isPlaying = false
        // `isPlaying` can only be true after `play()` has already run `prepare()`, so `prepared`
        // is guaranteed non-nil here.
        prepared!.playerNode.stop()
        prepared!.engine.stop()
    }
}
