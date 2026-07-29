import Testing
import Foundation
@testable import AnglesiteCore

struct StartupProgressEstimatorTests {

    private func make() -> StartupProgressEstimator {
        // A fast, explicit profile so ticks reach meaningful fractions at small times.
        StartupProgressEstimator(profile: StartupProfile(
            launchingToBuilding: 1, buildingToConnecting: 1, connectingToReady: 1))
    }

    @Test("Starts idle at zero with no message")
    func startsIdle() {
        let est = make()
        #expect(est.phase == .idle)
        #expect(est.fraction == 0)
        #expect(est.message == "")
        #expect(est.isActive == false)
    }

    @Test(".starting enters launching and becomes active")
    func startingEntersLaunching() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        #expect(est.phase == .launching)
        #expect(est.isActive)
        #expect(est.message == "Starting dev server…")
    }

    @Test("A non-URL astro line advances launching → building")
    func firstLogEntersBuilding() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "astro v5.0.0 ready in 120 ms", at: 0.2)
        #expect(est.phase == .building)
        #expect(est.message == "Building site…")
        #expect(est.fraction >= 0.15)   // jumped to building's lower bound
    }

    @Test("A Local-URL line advances to connecting")
    func urlLineEntersConnecting() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "  Building...", at: 0.2)
        est.ingest(logText: "┃ Local    http://localhost:4321/", at: 0.5)
        #expect(est.phase == .connecting)
        #expect(est.message == "Connecting to preview…")
        #expect(est.fraction >= 0.55)
    }

    @Test("A container-prefixed astro line still parses through to connecting")
    func containerPrefixedLineParses() {
        // Real lines from `LocalContainerSiteRuntime` are prefixed by the guest process label,
        // e.g. "[astro] ┃ Local    http://127.0.0.1:4321/" — the URL regex must still find the
        // URL despite the leading "[astro] " tag.
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "[astro] Building for production...", at: 0.2)
        est.ingest(logText: "[astro] ┃ Local    http://127.0.0.1:4321/", at: 0.5)
        #expect(est.phase == .connecting)
        #expect(est.fraction >= 0.55)
    }

    @Test("A URL line as the very first log jumps straight to connecting")
    func urlFirstLineSkipsBuilding() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "Local http://localhost:4321/", at: 0.3)
        #expect(est.phase == .connecting)
        #expect(est.fraction >= 0.55)
    }

    @Test(".ready completes the bar to 1.0")
    func readyCompletes() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "x", at: 0.2)
        est.ingest(logText: "Local http://localhost:4321/", at: 0.5)
        est.ingest(runtimeState: .ready(siteID: "s", url: URL(string: "http://localhost:4321/")!), at: 1.0)
        #expect(est.phase == .ready)
        #expect(est.fraction == 1.0)
        #expect(est.isActive == false)
    }

    @Test("tick eases the fraction forward but never reaches the phase cap")
    func tickAsymptotesUnderCap() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "building", at: 0)   // in building, cap 0.55
        est.tick(now: 0.5)
        let mid = est.fraction
        #expect(mid > 0.15)
        #expect(mid < 0.55)
        // Far past the expected segment: approaches the cap but never hits it.
        est.tick(now: 100)
        #expect(est.fraction < 0.55)
        #expect(est.fraction > mid)
    }

    @Test("fraction is monotonic non-decreasing across ticks and anchors")
    func monotonic() {
        var est = make()
        var last = 0.0
        func checkAndAdvance(_ f: Double) { #expect(f >= last); last = f }

        est.ingest(runtimeState: .starting(siteID: "s"), at: 0); checkAndAdvance(est.fraction)
        est.tick(now: 0.3); checkAndAdvance(est.fraction)
        est.ingest(logText: "building", at: 0.4); checkAndAdvance(est.fraction)
        est.tick(now: 0.8); checkAndAdvance(est.fraction)
        est.ingest(logText: "Local http://localhost:4321/", at: 1.0); checkAndAdvance(est.fraction)
        est.tick(now: 1.5); checkAndAdvance(est.fraction)
        est.ingest(runtimeState: .ready(siteID: "s", url: URL(string: "http://x/")!), at: 2.0); checkAndAdvance(est.fraction)
    }

    @Test("Fraction never reaches 1.0 before the ready anchor")
    func neverCompletesEarly() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "building", at: 0.1)
        est.ingest(logText: "Local http://x/", at: 0.2)
        est.tick(now: 10_000)
        #expect(est.fraction < 1.0)
    }

    @Test(".failed stops activity and clears the bar")
    func failedResets() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "building", at: 0.1)
        est.ingest(runtimeState: .failed(siteID: "s", message: "boom"), at: 0.5)
        #expect(est.phase == .failed)
        #expect(est.isActive == false)
        #expect(est.message == "")
    }

    @Test("Logs after ready are ignored")
    func logsAfterReadyIgnored() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(runtimeState: .ready(siteID: "s", url: URL(string: "http://x/")!), at: 1.0)
        est.ingest(logText: "Local http://other/", at: 1.5)
        #expect(est.phase == .ready)
        #expect(est.fraction == 1.0)
    }

    @Test("completedProfile reports measured segments after ready")
    func completedProfileMeasuresSegments() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 10)
        est.ingest(logText: "building", at: 10.5)                       // launching→building = 0.5
        est.ingest(logText: "Local http://x/", at: 13.5)               // building→connecting = 3.0
        est.ingest(runtimeState: .ready(siteID: "s", url: URL(string: "http://x/")!), at: 15.0) // connecting→ready = 1.5
        let p = est.completedProfile
        #expect(p != nil)
        #expect(abs((p?.launchingToBuilding ?? -1) - 0.5) < 0.0001)
        #expect(abs((p?.buildingToConnecting ?? -1) - 3.0) < 0.0001)
        #expect(abs((p?.connectingToReady ?? -1) - 1.5) < 0.0001)
    }

    @Test("completedProfile is nil before ready")
    func completedProfileNilBeforeReady() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(logText: "building", at: 0.2)
        #expect(est.completedProfile == nil)
    }

    @Test(".failed after ready does not clobber the completed bar")
    func failedAfterReadyIgnored() {
        var est = make()
        est.ingest(runtimeState: .starting(siteID: "s"), at: 0)
        est.ingest(runtimeState: .ready(siteID: "s", url: URL(string: "http://x/")!), at: 1.0)
        est.ingest(runtimeState: .failed(siteID: "s", message: "died"), at: 1.5)
        #expect(est.phase == .ready)
        #expect(est.fraction == 1.0)
    }

    @Test("panelFillCount maps each phase to the three-panel strip's fill count")
    func panelFillCountMapsPhases() {
        #expect(StartupPhase.idle.panelFillCount == 0)
        #expect(StartupPhase.launching.panelFillCount == 1)
        #expect(StartupPhase.building.panelFillCount == 1)
        #expect(StartupPhase.connecting.panelFillCount == 2)
        #expect(StartupPhase.ready.panelFillCount == 3)
        #expect(StartupPhase.failed.panelFillCount == 0)
    }
}
