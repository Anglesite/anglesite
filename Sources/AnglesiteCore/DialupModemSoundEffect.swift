import Foundation

/// A stylized, deterministic approximation of a Hayes-era K56flex modem handshake — not a
/// decode of K56flex's largely undocumented proprietary bitstream, but shaped like one: DTMF
/// dialing, the real ITU V.25 2100 Hz answer tone (with its echo-canceller-defeating phase
/// reversal), a digital-probe-style burst standing in for 56K's line-probing step, a couple of
/// negotiation sweeps, and a noise-like training burst. See
/// docs/superpowers/specs/2026-07-28-dialup-modem-sound-effect-design.md.
///
/// Pure `Foundation` math only (no `AVFoundation`) so this keeps compiling and testing on the
/// Linux CI lane along with the rest of `AnglesiteCore`.
public enum DialupModemSoundEffect {
    /// Standard CD-quality sample rate; `DialupSoundEffectPlayer` builds its `AVAudioFormat`
    /// to match.
    public static let sampleRate: Double = 44_100

    /// The number the handshake "dials": 802-748-1210, The Kingdom Connection BBS.
    public static let dialedDigits = "8027481210"

    /// One loop cycle's worth of samples, each within `[-1, 1]`. Pure function — calling this
    /// twice with the same `sampleRate` returns identical output.
    public static func samples(sampleRate: Double = sampleRate) -> [Float] {
        var result: [Float] = []
        result += dialTone(sampleRate: sampleRate)
        result += dtmfDialing(sampleRate: sampleRate)
        result += silence(duration: 0.3, sampleRate: sampleRate)
        result += answerTone(sampleRate: sampleRate)
        result += digitalProbeBurst(sampleRate: sampleRate)
        result += negotiationSweeps(sampleRate: sampleRate)
        result += trainingNoise(sampleRate: sampleRate)
        return result
    }

    // MARK: - Segments

    private static func dialTone(sampleRate: Double) -> [Float] {
        mixedTone(frequencies: [350, 440], duration: 0.4, amplitude: 0.2, sampleRate: sampleRate)
    }

    /// DTMF low/high frequency pairs per digit (ITU-T Q.23).
    private static let dtmfFrequencies: [Character: (low: Double, high: Double)] = [
        "1": (697, 1209), "2": (697, 1336), "3": (697, 1477),
        "4": (770, 1209), "5": (770, 1336), "6": (770, 1477),
        "7": (852, 1209), "8": (852, 1336), "9": (852, 1477),
        "0": (941, 1336),
    ]

    private static func dtmfDialing(sampleRate: Double) -> [Float] {
        var result: [Float] = []
        for digit in dialedDigits {
            guard let pair = dtmfFrequencies[digit] else { continue }
            result += mixedTone(
                frequencies: [pair.low, pair.high], duration: 0.08, amplitude: 0.25, sampleRate: sampleRate)
            result += silence(duration: 0.04, sampleRate: sampleRate)
        }
        return result
    }

    /// ITU-T V.25 answer tone: a continuous 2100 Hz tone whose phase reverses every ~450 ms, so
    /// an echo canceller at the far end can detect and disable itself.
    private static func answerTone(sampleRate: Double) -> [Float] {
        var result: [Float] = []
        for segment in 0..<3 {
            let phase = segment.isMultiple(of: 2) ? 0.0 : Double.pi
            result += sineWave(
                frequency: 2100, duration: 0.45, amplitude: 0.3, sampleRate: sampleRate, phase: phase)
        }
        return result
    }

    /// Stands in for the line-probing step unique to 56K (K56flex/x2/V.90) handshakes and absent
    /// from a plain V.34 33.6K handshake.
    private static func digitalProbeBurst(sampleRate: Double) -> [Float] {
        chirp(startFrequency: 300, endFrequency: 3300, duration: 0.15, amplitude: 0.25, sampleRate: sampleRate)
            + chirp(startFrequency: 3300, endFrequency: 300, duration: 0.15, amplitude: 0.25, sampleRate: sampleRate)
    }

    private static func negotiationSweeps(sampleRate: Double) -> [Float] {
        chirp(startFrequency: 1000, endFrequency: 3000, duration: 0.3, amplitude: 0.2, sampleRate: sampleRate)
            + chirp(startFrequency: 1200, endFrequency: 2800, duration: 0.3, amplitude: 0.2, sampleRate: sampleRate)
    }

    /// A deterministic noise-like burst standing in for the scrambled carrier training sequence,
    /// built from summed non-harmonic sine components rather than a seeded PRNG.
    private static func trainingNoise(sampleRate: Double) -> [Float] {
        let componentFrequencies: [Double] = [733, 911, 1237, 1583, 1871, 2203, 2617, 2999]
        let sampleCount = Int((0.7 * sampleRate).rounded())
        var result = [Float](repeating: 0, count: sampleCount)
        for frequency in componentFrequencies {
            for index in 0..<sampleCount {
                let t = Double(index) / sampleRate
                result[index] += Float(sin(2 * .pi * frequency * t) / Double(componentFrequencies.count))
            }
        }
        for index in 0..<sampleCount {
            result[index] *= 0.5
        }
        applyEdgeFades(&result, sampleRate: sampleRate)
        return result
    }

    // MARK: - Primitives

    private static func mixedTone(
        frequencies: [Double], duration: Double, amplitude: Double, sampleRate: Double
    ) -> [Float] {
        let sampleCount = Int((duration * sampleRate).rounded())
        var result = [Float](repeating: 0, count: sampleCount)
        for frequency in frequencies {
            for index in 0..<sampleCount {
                let t = Double(index) / sampleRate
                result[index] += Float(sin(2 * .pi * frequency * t) * amplitude / Double(frequencies.count))
            }
        }
        applyEdgeFades(&result, sampleRate: sampleRate)
        return result
    }

    private static func sineWave(
        frequency: Double, duration: Double, amplitude: Double, sampleRate: Double, phase: Double = 0
    ) -> [Float] {
        let sampleCount = Int((duration * sampleRate).rounded())
        var result = [Float](repeating: 0, count: sampleCount)
        for index in 0..<sampleCount {
            let t = Double(index) / sampleRate
            result[index] = Float(sin(2 * .pi * frequency * t + phase) * amplitude)
        }
        applyEdgeFades(&result, sampleRate: sampleRate)
        return result
    }

    /// Linear frequency sweep from `startFrequency` to `endFrequency`, using the proper
    /// quadratic phase integral (not just `frequency(t) * t`) so the sweep is a real chirp.
    private static func chirp(
        startFrequency: Double, endFrequency: Double, duration: Double, amplitude: Double, sampleRate: Double
    ) -> [Float] {
        let sampleCount = Int((duration * sampleRate).rounded())
        var result = [Float](repeating: 0, count: sampleCount)
        let rate = (endFrequency - startFrequency) / duration
        for index in 0..<sampleCount {
            let t = Double(index) / sampleRate
            let phase = 2 * .pi * (startFrequency * t + rate * t * t / 2)
            result[index] = Float(sin(phase) * amplitude)
        }
        applyEdgeFades(&result, sampleRate: sampleRate)
        return result
    }

    private static func silence(duration: Double, sampleRate: Double) -> [Float] {
        [Float](repeating: 0, count: Int((duration * sampleRate).rounded()))
    }

    /// 5ms linear fade in/out so concatenated segments don't click at the seams.
    private static func applyEdgeFades(_ samples: inout [Float], sampleRate: Double) {
        let fadeSamples = min(samples.count / 2, Int((0.005 * sampleRate).rounded()))
        guard fadeSamples > 0 else { return }
        for index in 0..<fadeSamples {
            let gain = Float(index) / Float(fadeSamples)
            samples[index] *= gain
            samples[samples.count - 1 - index] *= gain
        }
    }
}
