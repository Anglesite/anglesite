import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@MainActor
@Suite struct ExperimentStatsModelTests {
    @Test func canAnalyzeOnlyOnceBothVariantsHaveVisitors() {
        let model = ExperimentStatsModel(siteID: "s1")
        #expect(!model.canAnalyze)
        model.controlImpressions = 1000
        model.controlConversions = 50
        #expect(!model.canAnalyze)
        model.treatmentImpressions = 1000
        model.treatmentConversions = 120
        #expect(model.canAnalyze)
    }

    @Test func analyzeProducesAResultAndSummary() {
        let model = ExperimentStatsModel(siteID: "s1")
        model.experimentName = "Hero headline"
        model.controlImpressions = 1000
        model.controlConversions = 50
        model.treatmentImpressions = 1000
        model.treatmentConversions = 120
        model.analyze()
        #expect(model.result != nil)
        #expect(model.summary?.contains("Hero headline") == true)
    }

    @Test func editAgainClearsTheResultButKeepsCounts() {
        let model = ExperimentStatsModel(siteID: "s1")
        model.controlImpressions = 1000
        model.controlConversions = 50
        model.treatmentImpressions = 1000
        model.treatmentConversions = 120
        model.analyze()
        #expect(model.result != nil)
        model.editAgain()
        #expect(model.result == nil)
        #expect(model.controlImpressions == 1000)
    }

    @Test func suggestionPlaybookIsAlwaysAvailable() {
        let model = ExperimentStatsModel(siteID: "s1")
        #expect(!model.suggestions.isEmpty)
        #expect(model.suggestions == ExperimentStats.suggestionPlaybook)
    }
}
