import Foundation
import Testing
import AnglesiteCore
@testable import AnglesiteAppCore

/// Records `play()`/`stop()` calls instead of touching real audio, so these tests exercise
/// `StartupProgressModel`'s state machine without any AVFoundation dependency.
@MainActor
private final class FakeSoundEffectPlayer: DialupSoundEffectPlaying {
    private(set) var playCount = 0
    private(set) var stopCount = 0
    func play() { playCount += 1 }
    func stop() { stopCount += 1 }
}

@MainActor
struct StartupProgressModelTests {
    private let suiteName = "test-anglesite-startup-progress-\(UUID().uuidString)"

    private func make() -> StartupProgressModel {
        let defaults = UserDefaults(suiteName: suiteName)!
        return StartupProgressModel(
            timingStore: StartupTimingStore(defaults: defaults),
            logCenter: LogCenter(),
            soundEffect: FakeSoundEffectPlayer(),
            clock: { 0 }
        )
    }

    private let readyURL = URL(string: "http://localhost:4321")!

    @Test("Reaching .ready begins the completion hold")
    func readyBeginsHold() async {
        let model = make()
        model.ingest(state: .starting(siteID: "s"))
        model.ingest(state: .ready(siteID: "s", url: readyURL))
        #expect(model.isShowingCompletionHold)
    }

    @Test("stop() clears an active completion hold")
    func stopClearsHold() async {
        let model = make()
        model.ingest(state: .starting(siteID: "s"))
        model.ingest(state: .ready(siteID: "s", url: readyURL))
        #expect(model.isShowingCompletionHold)
        model.stop()
        #expect(!model.isShowingCompletionHold)
    }

    @Test(".failed after .ready cancels the hold")
    func failedAfterReadyCancelsHold() async {
        let model = make()
        model.ingest(state: .starting(siteID: "s"))
        model.ingest(state: .ready(siteID: "s", url: readyURL))
        #expect(model.isShowingCompletionHold)
        model.ingest(state: .failed(siteID: "s", message: "crashed"))
        #expect(!model.isShowingCompletionHold)
    }

    @Test(".idle after .ready cancels the hold")
    func idleAfterReadyCancelsHold() async {
        let model = make()
        model.ingest(state: .starting(siteID: "s"))
        model.ingest(state: .ready(siteID: "s", url: readyURL))
        #expect(model.isShowingCompletionHold)
        model.ingest(state: .idle)
        #expect(!model.isShowingCompletionHold)
    }

    @Test("A second .ready while still holding extends the hold, not cancels it (regression: #stop() previously cut it short)")
    func secondReadyWhileHoldingExtendsHold() async {
        let model = make()
        model.ingest(state: .starting(siteID: "s"))
        model.ingest(state: .ready(siteID: "s", url: readyURL))
        #expect(model.isShowingCompletionHold)
        // A re-settle to `.ready` with a different payload (e.g. workersDevURL changing) while
        // the first hold is still counting down — `estimator.isActive` is already false here
        // (the estimator is already at `.ready`), so only the `wasHolding` branch keeps this true.
        model.ingest(state: .ready(siteID: "s", url: readyURL, workersDevURL: URL(string: "http://localhost:9999")))
        #expect(model.isShowingCompletionHold)
    }

    @Test("A re-ready after the hold has already ended does not resurrect it")
    func readyAfterHoldEndedDoesNotResurrect() async throws {
        let model = make()
        model.ingest(state: .starting(siteID: "s"))
        model.ingest(state: .ready(siteID: "s", url: readyURL))
        #expect(model.isShowingCompletionHold)
        try await Task.sleep(nanoseconds: 700_000_000) // past the ~500ms hold window
        #expect(!model.isShowingCompletionHold)
        model.ingest(state: .ready(siteID: "s", url: readyURL, workersDevURL: URL(string: "http://localhost:9999")))
        #expect(!model.isShowingCompletionHold)
    }
}
