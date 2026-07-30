# Dial-up Modem Sound Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, off-by-default synthesized dial-up modem sound effect that plays while the dev server is starting up and while a deploy is running.

**Architecture:** A pure sample-synthesis type (`DialupModemSoundEffect`) lives in `AnglesiteCore` and is unit-tested there. A thin `AVAudioEngine`-based player (`DialupSoundEffectPlayer`, behind a `DialupSoundEffectPlaying` protocol) lives in `AnglesiteApp`/`AnglesiteAppCore` and is wired into the two existing "loading" state machines — `StartupProgressModel` (dev-server startup) and `DeployModel.onPhaseTransition` via `SiteWindowModel` (deploy) — without a shared/coordinated player instance. A single new `AppSettings` toggle, surfaced in `SettingsView`, gates both triggers.

**Tech Stack:** Swift 6.4, SwiftPM (`AnglesiteCore`, `AnglesiteAppCore` targets), AVFoundation (`AVAudioEngine`/`AVAudioPlayerNode`/`AVAudioPCMBuffer`), Swift Testing.

## Global Constraints

- No third-party dependencies — Apple frameworks only (AVFoundation).
- The sample generator (`AnglesiteCore`) must use only `Foundation` trig math — no `AVFoundation` import — so it keeps compiling and testing on the Linux CI lane.
- All synthesized sample values stay within `[-1, 1]`.
- Sample generation is deterministic: no `Date()`/`Math.random()`-style time-seeded randomness.
- DTMF dial sequence is exactly `8027481210` (802-748-1210, The Kingdom Connection BBS).
- Handshake flavor is K56flex-shaped (V.25 2100 Hz answer tone with phase reversal, then a digital-probe-style burst, then negotiation sweeps, then training noise) — not a literal x2/V.90 decode.
- New setting key: `AppSettings.Key.playsDialupSoundEffect` = `"anglesite.playsDialupSoundEffect"`, plain `Bool`, defaults to `false` (absent-defaults-to-false; no inversion trick).
- `DialupSoundEffectPlayer` (the `AVAudioEngine`-touching class) and its wiring into `StartupProgressModel`/`SiteWindowModel` stay untested directly — matches the existing `CompletionNotifier` convention in this codebase. Only the pure sample generator and the `AppSettings` property get unit tests.
- Every task that touches `Sources/AnglesiteApp/` must be verified with `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` (not just `swift test`), and any new user-visible `Text`/`Toggle` string needs the String Catalog sync described in `CONTRIBUTING.md`.
- Conventional commit subjects, ≤72 characters.

---

### Task 1: Synthesize the dial-up modem sound (`AnglesiteCore`)

**Files:**
- Create: `Sources/AnglesiteCore/DialupModemSoundEffect.swift`
- Test: `Tests/AnglesiteCoreTests/DialupModemSoundEffectTests.swift`

**Interfaces:**
- Consumes: nothing (pure `Foundation` math only).
- Produces: `public enum DialupModemSoundEffect` with `public static let sampleRate: Double`, `public static let dialedDigits: String`, and `public static func samples(sampleRate: Double = sampleRate) -> [Float]`. Later tasks (`DialupSoundEffectPlayer` in Task 3) call `DialupModemSoundEffect.samples()` and `DialupModemSoundEffect.sampleRate`.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/DialupModemSoundEffectTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DialupModemSoundEffectTests`
Expected: FAIL to build — `DialupModemSoundEffect` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/DialupModemSoundEffect.swift`:

```swift
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter DialupModemSoundEffectTests`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DialupModemSoundEffect.swift Tests/AnglesiteCoreTests/DialupModemSoundEffectTests.swift
git commit -m "feat: synthesize dial-up modem handshake sound"
```

---

### Task 2: Add the `playsDialupSoundEffect` setting (`AnglesiteCore`)

**Files:**
- Modify: `Sources/AnglesiteCore/AppSettings.swift:27` (add key), `:194` (add property after `notifiesOnCompletion`)
- Test: `Tests/AnglesiteCoreTests/AppSettingsTests.swift`

**Interfaces:**
- Consumes: `AppSettings` class from Task-independent existing code (no dependency on Task 1).
- Produces: `AppSettings.Key.playsDialupSoundEffect: String` and `AppSettings.playsDialupSoundEffect: Bool` (get/set). Task 3's `DialupSoundEffectPlayer` and Task 6's `SettingsView` both read/bind this property.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/AppSettingsTests.swift` (near the `debugPaneEnabled` tests, same file):

```swift
    @Test("playsDialupSoundEffect defaults to false") func playsDialupSoundEffectDefaultsToFalse() {
        let settings = AppSettings(defaults: defaults)
        #expect(!settings.playsDialupSoundEffect)
    }

    @Test("playsDialupSoundEffect round trip") func playsDialupSoundEffectRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.playsDialupSoundEffect = true
        #expect(settings.playsDialupSoundEffect)
        settings.playsDialupSoundEffect = false
        #expect(!settings.playsDialupSoundEffect)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter AppSettingsTests`
Expected: FAIL to build — `playsDialupSoundEffect` is not a member of `AppSettings`.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/AppSettings.swift`, add the key right after `notifiesOnCompletion` (currently line 27):

```swift
        public static let notifiesOnCompletion = "anglesite.notifiesOnCompletion"
        public static let playsDialupSoundEffect = "anglesite.playsDialupSoundEffect"
```

Add the property right after the `notifiesOnCompletion` property block (currently ends at line 194, just before `lastOpenedSiteID`):

```swift
    /// Whether Anglesite plays a synthesized dial-up modem handshake sound while the dev server
    /// starts up (`StartupProgressModel`) or a deploy runs (`DeployModel`). Purely decorative —
    /// off by default, so `false` when absent needs no inversion trick.
    public var playsDialupSoundEffect: Bool {
        get { defaults.bool(forKey: Key.playsDialupSoundEffect) }
        set { defaults.set(newValue, forKey: Key.playsDialupSoundEffect) }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter AppSettingsTests`
Expected: PASS — including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/AppSettings.swift Tests/AnglesiteCoreTests/AppSettingsTests.swift
git commit -m "feat: add playsDialupSoundEffect setting"
```

---

### Task 3: Playback glue — `DialupSoundEffectPlayer` (`AnglesiteApp`)

**Files:**
- Create: `Sources/AnglesiteApp/DialupSoundEffectPlayer.swift`

**Interfaces:**
- Consumes: `DialupModemSoundEffect.samples()` / `.sampleRate` (Task 1), `AppSettings.shared.playsDialupSoundEffect` (Task 2).
- Produces: `@MainActor protocol DialupSoundEffectPlaying { func play(); func stop() }` and `@MainActor final class DialupSoundEffectPlayer: DialupSoundEffectPlaying` with `init(settings: AppSettings = .shared)`. Task 4 (`StartupProgressModel`) and Task 5 (`SiteWindowModel`) both construct `DialupSoundEffectPlayer()` and call `.play()`/`.stop()`.

This class is deliberately **not** unit tested (see Global Constraints) — same shape as `CompletionNotifier`. Verification is a successful build, not a test run.

- [ ] **Step 1: Write the implementation**

Create `Sources/AnglesiteApp/DialupSoundEffectPlayer.swift`:

```swift
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
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)
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
        playerNode.play()
    }

    func stop() {
        guard isPlaying else { return }
        isPlaying = false
        playerNode.stop()
        engine.stop()
    }
}
```

- [ ] **Step 2: Regenerate the Xcode project and build**

Run: `xcodegen generate`
Expected: regenerates `Anglesite.xcodeproj` to pick up the new file (folder-referenced source, per `project.yml`).

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/DialupSoundEffectPlayer.swift
git commit -m "feat: add AVAudioEngine-based dial-up sound player"
```

---

### Task 4: Wire the sound into dev-server startup (`StartupProgressModel`)

**Files:**
- Modify: `Sources/AnglesiteApp/StartupProgressModel.swift:17-34` (properties + init), `:56-60` (`stop()`), `:64-73` (`begin(siteID:)`)

**Interfaces:**
- Consumes: `DialupSoundEffectPlaying` / `DialupSoundEffectPlayer` (Task 3).
- Produces: no new public interface — `StartupProgressModel`'s existing `ingest(state:)` behavior gains a side effect.

No new tests (see Global Constraints — this class has no dedicated test file today; `StartupProgressEstimatorTests` covers the pure estimator it wraps, and that's unaffected by this change). Verification is the full test suite staying green plus a clean build.

- [ ] **Step 1: Add the dependency and wire it in**

In `Sources/AnglesiteApp/StartupProgressModel.swift`, change:

```swift
    private let timingStore: StartupTimingStore
    private let logCenter: LogCenter
    private let clock: @Sendable () -> TimeInterval

    private var estimator = StartupProgressEstimator()
    private var siteID: String?
    private var logTask: Task<Void, Never>?
    private var tickTask: Task<Void, Never>?

    init(
        timingStore: StartupTimingStore = .shared,
        logCenter: LogCenter = .shared,
        clock: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    ) {
        self.timingStore = timingStore
        self.logCenter = logCenter
        self.clock = clock
    }
```

to:

```swift
    private let timingStore: StartupTimingStore
    private let logCenter: LogCenter
    private let soundEffect: DialupSoundEffectPlaying
    private let clock: @Sendable () -> TimeInterval

    private var estimator = StartupProgressEstimator()
    private var siteID: String?
    private var logTask: Task<Void, Never>?
    private var tickTask: Task<Void, Never>?

    init(
        timingStore: StartupTimingStore = .shared,
        logCenter: LogCenter = .shared,
        soundEffect: DialupSoundEffectPlaying = DialupSoundEffectPlayer(),
        clock: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    ) {
        self.timingStore = timingStore
        self.logCenter = logCenter
        self.soundEffect = soundEffect
        self.clock = clock
    }
```

Change `stop()` from:

```swift
    func stop() {
        logTask?.cancel(); logTask = nil
        tickTask?.cancel(); tickTask = nil
    }
```

to:

```swift
    func stop() {
        logTask?.cancel(); logTask = nil
        tickTask?.cancel(); tickTask = nil
        soundEffect.stop()
    }
```

Change `begin(siteID:)` from:

```swift
    private func begin(siteID: String) {
        // Re-arm only on a genuinely new startup; ignore a duplicate `.starting` for the same site.
        if self.siteID == siteID && estimator.isActive { return }
        self.siteID = siteID
        estimator = StartupProgressEstimator(profile: timingStore.profile(for: siteID))
        estimator.ingest(runtimeState: .starting(siteID: siteID), at: clock())
        publish()
        subscribeToLogs(siteID: siteID)
        startTicker()
    }
```

to:

```swift
    private func begin(siteID: String) {
        // Re-arm only on a genuinely new startup; ignore a duplicate `.starting` for the same site.
        if self.siteID == siteID && estimator.isActive { return }
        self.siteID = siteID
        estimator = StartupProgressEstimator(profile: timingStore.profile(for: siteID))
        estimator.ingest(runtimeState: .starting(siteID: siteID), at: clock())
        soundEffect.play()
        publish()
        subscribeToLogs(siteID: siteID)
        startTicker()
    }
```

- [ ] **Step 2: Run the full test suite and build**

Run: `swift test --package-path .`
Expected: PASS — no regressions (in particular, nothing in `AnglesiteAppTests` constructs `StartupProgressModel()` with a real player mid-test in a way that would touch actual audio hardware, since the default `DialupSoundEffectPlayer()` only starts the engine when `AppSettings.shared.playsDialupSoundEffect` is `true`, which is `false` by default in a fresh `UserDefaults.standard` on a CI runner).

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/StartupProgressModel.swift
git commit -m "feat: play dial-up sound while the dev server starts"
```

---

### Task 5: Wire the sound into deploys (`SiteWindowModel`)

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:256-260`

**Interfaces:**
- Consumes: `DialupSoundEffectPlaying` / `DialupSoundEffectPlayer` (Task 3), `DeployModel.Phase` (existing).
- Produces: no new public interface.

No new tests (see Global Constraints — `SiteWindowModel`'s existing `backupHook`/`deployHook` closure composition has no dedicated unit tests today either). Verification is the full test suite staying green plus a clean build.

- [ ] **Step 1: Layer the sound effect onto the existing deploy hook**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, change:

```swift
        let deployHook = deploy.onPhaseTransition
        deploy.onPhaseTransition = { [weak self] siteID, phase in
            deployHook?(siteID, phase)
            if case .succeeded = phase { self?.sync.deployCompleted() }
        }
    }
```

to:

```swift
        let deployHook = deploy.onPhaseTransition
        let deploySound: DialupSoundEffectPlaying = DialupSoundEffectPlayer()
        deploy.onPhaseTransition = { [weak self] siteID, phase in
            deployHook?(siteID, phase)
            if case .succeeded = phase { self?.sync.deployCompleted() }
            if case .running = phase { deploySound.play() } else { deploySound.stop() }
        }
    }
```

(`deploySound` is captured by value into the closure — it needs no `self` reference, so it plays/stops correctly for the run's whole lifetime independent of whether the window itself is still open, same as the rest of this hook.)

- [ ] **Step 2: Run the full test suite and build**

Run: `swift test --package-path .`
Expected: PASS — no regressions.

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift
git commit -m "feat: play dial-up sound while a deploy is running"
```

---

### Task 6: Settings UI toggle

**Files:**
- Modify: `Sources/AnglesiteApp/SettingsView.swift:22-59` (`GeneralSettingsView`)

**Interfaces:**
- Consumes: `AppSettings.Key.playsDialupSoundEffect` (Task 2).
- Produces: no new interface — a new `Toggle` bound via `@AppStorage`.

- [ ] **Step 1: Add the toggle and its section**

In `Sources/AnglesiteApp/SettingsView.swift`, change the `GeneralSettingsView` property list from:

```swift
private struct GeneralSettingsView: View {
    @AppStorage(AppSettings.Key.autoGenerateAltText) private var autoGenerateAltText: Bool = true
    @AppStorage(AppSettings.Key.autoGeneratePageCopy) private var autoGeneratePageCopy: Bool = true
    @AppStorage(AppSettings.Key.announcesLiveUpdates) private var announcesLiveUpdates: Bool = true
    @AppStorage(AppSettings.Key.notifiesOnCompletion) private var notifiesOnCompletion: Bool = true
```

to:

```swift
private struct GeneralSettingsView: View {
    @AppStorage(AppSettings.Key.autoGenerateAltText) private var autoGenerateAltText: Bool = true
    @AppStorage(AppSettings.Key.autoGeneratePageCopy) private var autoGeneratePageCopy: Bool = true
    @AppStorage(AppSettings.Key.announcesLiveUpdates) private var announcesLiveUpdates: Bool = true
    @AppStorage(AppSettings.Key.notifiesOnCompletion) private var notifiesOnCompletion: Bool = true
    @AppStorage(AppSettings.Key.playsDialupSoundEffect) private var playsDialupSoundEffect: Bool = false
```

Then insert a new `Section("Sound")` between the existing `Section("Notifications")` and `Section("Accessibility")`:

```swift
            Section("Notifications") {
                Toggle("Notify when site operations finish", isOn: $notifiesOnCompletion)
                Text("Posts a notification when a Deploy, Backup, or Audit finishes while Anglesite is in the background — success or failure. Clicking the notification brings the site's window to the front. Delivery starts quietly; promote or silence Anglesite in System Settings › Notifications.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Sound") {
                Toggle("Play dial-up sound while loading", isOn: $playsDialupSoundEffect)
                Text("Plays a nostalgic dial-up modem sound while the dev server starts up or a deploy is running. Purely decorative — off by default.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Accessibility") {
```

- [ ] **Step 2: Regenerate the Xcode project and build**

Run: `xcodegen generate` (no new file was added here, but this keeps the routine consistent — safe to run regardless).

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Sync the String Catalog**

New user-visible literals (`"Sound"`, `"Play dial-up sound while loading"`, the caption text) only merge into `Sources/AnglesiteApp/Localizable.xcstrings` inside the Xcode IDE, not via CLI `xcodebuild build` alone. Per `CONTRIBUTING.md` ▸ "Commit String Catalog updates", derive the `.stringsdata` path from this worktree's own build settings and sync with `--skip-marking-strings-stale`:

```bash
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

Review the resulting diff to `Localizable.xcstrings`: it should add only the new strings from this task (`"Sound"`, `"Play dial-up sound while loading"`, and the caption), not keys belonging to unrelated in-flight work. If it looks larger than that, re-run after a clean build scoped to this worktree rather than committing it as-is (see `CONTRIBUTING.md` for the full troubleshooting notes).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/SettingsView.swift Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "feat: add Settings toggle for the dial-up sound effect"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Swift test suite**

Run: `swift test --package-path .`
Expected: PASS — all targets, including the new `DialupModemSoundEffectTests` and `AppSettingsTests` cases.

- [ ] **Step 2: Full app build**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Manual smoke check**

Open the built app (or `open Anglesite.xcodeproj` and run from Xcode), open Settings ▸ General, confirm the new "Sound" section shows "Play dial-up sound while loading" (off by default) with the expected caption. Turn it on, open or restart a site's dev server, and confirm the handshake sound plays and stops when the preview becomes ready. Trigger a deploy and confirm the sound plays during `.running` and stops at the end (success, failure, or blocked).

- [ ] **Step 4: Confirm no stray changes**

Run: `git status --short`
Expected: clean (everything from Tasks 1–6 already committed).
