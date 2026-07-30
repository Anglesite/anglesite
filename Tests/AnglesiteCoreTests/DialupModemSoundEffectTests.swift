import Testing
import Foundation
@testable import AnglesiteCore

struct DialupModemSoundEffectTests {

    @Test("Loop cycle is about five seconds of audio")
    func loopDuration() {
        let samples = DialupModemSoundEffect.samples()
        let seconds = Double(samples.count) / DialupModemSoundEffect.sampleRate
        #expect(seconds > 4.5 && seconds < 5.5)
    }

    @Test("Every sample stays within [-1, 1]")
    func samplesInRange() {
        let samples = DialupModemSoundEffect.samples()
        #expect(samples.allSatisfy { $0 >= -1 && $0 <= 1 })
    }

    @Test("Generation is deterministic")
    func deterministic() {
        #expect(DialupModemSoundEffect.samples() == DialupModemSoundEffect.samples())
    }

    @Test("Loop is not silent")
    func notSilent() {
        let samples = DialupModemSoundEffect.samples()
        let peak = samples.map { abs($0) }.max() ?? 0
        #expect(peak > 0.05)
    }

    @Test("Dials the Kingdom Connection's number")
    func dialsExpectedNumber() {
        #expect(DialupModemSoundEffect.dialedDigits == "8027481210")
    }

    @Test("A different sample rate still produces in-range, non-empty audio")
    func differentSampleRate() {
        let samples = DialupModemSoundEffect.samples(sampleRate: 22_050)
        #expect(!samples.isEmpty)
        #expect(samples.allSatisfy { $0 >= -1 && $0 <= 1 })
    }
}
