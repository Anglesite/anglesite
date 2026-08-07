import Testing
import Foundation
@testable import AnglesiteIntents
import AnglesiteCore

extension AppIntentsTests {
    @Suite("ExperimentIntents")
    struct ExperimentIntentsTests {
        @Test("AnalyzeExperimentIntent reports a treatment win")
        func reportsTreatmentWin() {
            var intent = AnalyzeExperimentIntent()
            intent.experimentName = "Hero headline"
            intent.controlName = "Original"
            intent.controlImpressions = 1000
            intent.controlConversions = 50
            intent.treatmentName = "New headline"
            intent.treatmentImpressions = 1000
            intent.treatmentConversions = 120
            let dialog = intent.performForTesting()
            #expect(dialog.contains("Hero headline"))
            #expect(dialog.contains("New headline"))
            #expect(dialog.contains("outperforming"))
        }

        @Test("AnalyzeExperimentIntent flags insufficient data")
        func flagsInsufficientData() {
            var intent = AnalyzeExperimentIntent()
            intent.experimentName = ""
            intent.controlName = "Original"
            intent.controlImpressions = 10
            intent.controlConversions = 1
            intent.treatmentName = "Variant"
            intent.treatmentImpressions = 10
            intent.treatmentConversions = 1
            let dialog = intent.performForTesting()
            #expect(dialog.contains("Not much traffic yet"))
        }

        @Test("AnalyzeExperimentIntent flags a sample ratio mismatch")
        func flagsSampleRatioMismatch() {
            var intent = AnalyzeExperimentIntent()
            intent.experimentName = "Skewed test"
            intent.controlName = "Original"
            intent.controlImpressions = 9000
            intent.controlConversions = 450
            intent.treatmentName = "Variant"
            intent.treatmentImpressions = 1000
            intent.treatmentConversions = 60
            let dialog = intent.performForTesting()
            #expect(dialog.contains("traffic split looks off"))
        }
    }
}
