import Testing
@testable import AnglesiteCore

struct DeployPanelProgressTests {

    @Test("No milestone yet reads as zero filled panels")
    func noMilestone() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: nil, succeeded: false) == 0)
    }

    @Test("preflightScan and building read as one filled panel")
    func earlyMilestones() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "preflightScan", succeeded: false) == 1)
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "building", succeeded: false) == 1)
    }

    @Test("deploying and every later milestone read as two filled panels")
    func lateMilestones() {
        let phases = ["deploying", "finalizing", "webmentions", "syndicating", "websubPing", "activityPubBackfill"]
        for phase in phases {
            #expect(DeployPanelProgress.filledCount(currentMilestonePhase: phase, succeeded: false) == 2)
        }
    }

    @Test("An unrecognized milestone string reads forward as two filled panels, not back to zero")
    func unrecognizedMilestoneDefaultsForward() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "someFutureMilestone", succeeded: false) == 2)
    }

    @Test("succeeded always reads as three filled panels, regardless of milestone")
    func succeededWins() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "preflightScan", succeeded: true) == 3)
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: nil, succeeded: true) == 3)
    }
}
