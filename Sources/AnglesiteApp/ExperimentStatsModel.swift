import Foundation
import Observation
import AnglesiteCore

/// Drives the Experiment Results sheet (#769): a manual-entry front door onto `ExperimentStats`.
/// The retired Claude Code plugin's edge A/B machinery (cookie-based variant assignment, an
/// analytics pipeline reporting impressions/conversions back to the app) was never rebuilt after
/// #466 — see `ExperimentStats`' doc comment and the follow-up (#1270) — so this sheet takes the
/// two variants' counts as owner-typed input (read off whatever analytics the owner already has)
/// rather than reading them from a stored experiment config. Fresh-per-open, same lifecycle as
/// `CopyEditReportModel`.
@Observable @MainActor
final class ExperimentStatsModel: Identifiable {
    let id = UUID()
    let siteID: String

    var experimentName: String = ""
    var controlName: String = "Original"
    var controlImpressions: Int = 0
    var controlConversions: Int = 0
    var treatmentName: String = "Variant"
    var treatmentImpressions: Int = 0
    var treatmentConversions: Int = 0

    private(set) var result: ExperimentStats.Result?
    private(set) var hasSufficientData = false
    private(set) var sampleRatioMismatch = false

    let suggestions = ExperimentStats.suggestionPlaybook

    init(siteID: String) {
        self.siteID = siteID
    }

    /// Both variants need at least one visitor before there's anything to analyze —
    /// `ExperimentStats.Variant`'s own clamping already handles zero/negative conversions.
    var canAnalyze: Bool {
        controlImpressions > 0 && treatmentImpressions > 0
    }

    func analyze() {
        guard canAnalyze else { return }
        let control = ExperimentStats.Variant(
            name: controlName.isEmpty ? "Original" : controlName,
            impressions: controlImpressions, conversions: controlConversions)
        let treatment = ExperimentStats.Variant(
            name: treatmentName.isEmpty ? "Variant" : treatmentName,
            impressions: treatmentImpressions, conversions: treatmentConversions)
        result = ExperimentStats.analyze(control: control, treatment: treatment)
        hasSufficientData = ExperimentStats.hasSufficientData(control: control, treatment: treatment)
        sampleRatioMismatch = ExperimentStats.hasSampleRatioMismatch(control: control, treatment: treatment)
    }

    var summary: String? {
        guard let result else { return nil }
        return ExperimentStats.formatSummary(
            experimentName: experimentName.isEmpty ? "Experiment" : experimentName, result: result)
    }

    /// Clears the result so the owner can revise counts and re-analyze — doesn't reset the
    /// entered counts themselves.
    func editAgain() {
        result = nil
    }
}
