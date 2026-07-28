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
    private let settings: AppSettings
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let buffer: AVAudioPCMBuffer
    private var isPlaying = false

    init(settings: AppSettings = .shared) {
        self.settings = settings
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
        self.buffer = pcmBuffer
        engine.attach(playerNode)
        // Freshly attached nodes with this fixed, known-good format can't realistically fail to
        // connect, so a thrown error here (macOS 27's throwing `connectNode` replaces the
        // deprecated non-throwing `connect`) is discarded like the force-unwraps above.
        try? engine.connectNode(playerNode, to: engine.mainMixerNode, format: format)
    }

    func play() {
        guard settings.playsDialupSoundEffect, !isPlaying else { return }
        isPlaying = true
        do {
            try engine.start()
        } catch {
            // Purely decorative — a failure to start the audio engine (e.g. no output device)
            // should never surface to the user or block the operation it's soundtracking.
            isPlaying = false
            return
        }
        playerNode.scheduleBuffer(buffer, at: nil, options: .loops)
        do {
            // macOS 27's throwing `playAudio` replaces the deprecated non-throwing `play`.
            try playerNode.playAudio()
        } catch {
            // Same rationale as the `engine.start()` failure above: never surface or block.
            isPlaying = false
            playerNode.stop()
            engine.stop()
        }
    }

    func stop() {
        guard isPlaying else { return }
        isPlaying = false
        playerNode.stop()
        engine.stop()
    }
}
