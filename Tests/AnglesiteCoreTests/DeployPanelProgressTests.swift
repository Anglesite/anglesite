import Testing
@testable import AnglesiteCore

struct DeployPanelProgressTests {

    @Test("No milestone yet reads as zero filled panels")
    func noMilestone() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: nil, succeeded: false) == 0)
    }

    @Test("preflightScan and building read as one filled panel")
    func earlyMilestones() {
        #expect(DeployPanelProgress.filledCount(
            currentMilestonePhase: OperationProgress.deployPreflight.phase, succeeded: false) == 1)
        #expect(DeployPanelProgress.filledCount(
            currentMilestonePhase: OperationProgress.deployBuilding.phase, succeeded: false) == 1)
    }

    @Test("deploying and every later milestone read as two filled panels")
    func lateMilestones() {
        let phases = [
            OperationProgress.deployDeploying.phase,
            OperationProgress.deployFinalizing.phase,
            OperationProgress.deployWebmentions.phase,
            OperationProgress.deploySyndicating.phase,
            OperationProgress.deployNotifyingSubscribers.phase,
            OperationProgress.deployBackfillingActivityPub.phase,
        ]
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
        #expect(DeployPanelProgress.filledCount(
            currentMilestonePhase: OperationProgress.deployPreflight.phase, succeeded: true) == 3)
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: nil, succeeded: true) == 3)
    }

    @Test("Filled count is non-decreasing across the real emission order")
    func realEmissionOrderIsNonDecreasing() {
        // Real order (verified in DeployCommand.swift): building, preflightScan, deploying,
        // finalizing — NOT the preflight-then-build order the design doc's prose implies.
        let order = [
            OperationProgress.deployBuilding.phase,
            OperationProgress.deployPreflight.phase,
            OperationProgress.deployDeploying.phase,
            OperationProgress.deployFinalizing.phase,
        ]
        var previous = 0
        for phase in order {
            let count = DeployPanelProgress.filledCount(currentMilestonePhase: phase, succeeded: false)
            #expect(count >= previous)
            previous = count
        }
    }
}
